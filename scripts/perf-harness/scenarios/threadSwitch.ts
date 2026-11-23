/**
 * Thread switch (plan §4.2). One page opens the app, then clicks ten seeded
 * threads in the sidebar once each (first visits, empty cache) and switches
 * among them twenty more times. Each switch runs from the click's
 * `event.timeStamp` to the `e6:thread:rows:*` and `e6:thread:live` marks the
 * chat view sets for the routed thread. The idle check and screenshot run on
 * the last thread once it is live.
 *
 * The client keeps visited threads live for minutes, so those revisits show
 * `rows:live` and their live mark proves nothing. Both rows are measured
 * after a reload in the same context: IndexedDB still holds the visited
 * threads, and the fresh page has subscribed only to the routed one, so
 * switching to any other visited thread shows its cached rows first and then
 * syncs it live. One reload gives nine such switches; the page reloads again
 * until there are enough. The client marks those rows `rows:synchronizing`
 * (it is syncing by the time they render), so whether they were cached is
 * read from the wire. `threadSwitchRows.ts` turns the switches into rows.
 *
 * @module perf-harness/scenarios/threadSwitch
 */
import { parseThreadMark, THREAD_MARK_PREFIX } from "@e6tools/shared/threadMarks";
import type { Page } from "playwright-core";

import {
  captureWsFrames,
  clearMarks,
  idleCheck,
  newMeasuredContext,
  readPageTimings,
  sleep,
  waitForMark,
  type PageGlobal,
} from "../browser.ts";
import { summarize } from "../stats.ts";
import { threadSubscriptions } from "../wsFrames.ts";
import { loadUntilInteractive } from "./coldLoad.ts";
import {
  idlePoint,
  screenshotIfStill,
  type ScenarioContext,
  type ScenarioResult,
} from "./scenario.ts";
import { threadSwitchMetrics, type Switch, type SwitchSource } from "./threadSwitchRows.ts";

const THREADS = 10;
const REVISITS = 20;
const CACHED_SWITCHES = 12;
const MAX_RELOADS = 3;
const PERSIST_TIMEOUT_MS = 15_000;
const ROWS_TIMEOUT_MS = 15_000;
const LIVE_TIMEOUT_MS = 20_000;
// Lets the switched-to thread finish its follow-up work before the next click.
const SETTLE_MS = 300;

/** Sidebar row keys (`<environmentId>:<threadId>`) in the order the sidebar renders them. */
export function sidebarRowKeys(page: Page): Promise<Array<string>> {
  return page.evaluate(() =>
    Array.from(
      (globalThis as unknown as PageGlobal).document.querySelectorAll(
        "[data-thread-item] [data-sidebar-row]",
      ),
      (element) => element.getAttribute("data-sidebar-row") ?? "",
    ).filter((key) => key.length > 0),
  );
}

export const threadIdOf = (key: string) => key.slice(key.indexOf(":") + 1);

/** Thread ids the web client's IndexedDB cache holds, read the way the client stores them. */
function cachedThreadKeys(page: Page): Promise<Array<string>> {
  return page.evaluate(async () => {
    interface Request<A> {
      readonly result: A;
      addEventListener(type: "success" | "error", listener: () => void): void;
    }
    const global = globalThis as unknown as {
      readonly indexedDB: {
        open(name: string): Request<{
          readonly objectStoreNames: { contains(name: string): boolean };
          transaction(
            store: string,
            mode: string,
          ): { objectStore(name: string): { getAllKeys(): Request<ReadonlyArray<unknown>> } };
          close(): void;
        }>;
      };
    };
    const request = global.indexedDB.open("e6code:connection-runtime");
    const database = await new Promise<(typeof request)["result"] | null>((resolve) => {
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => resolve(null));
    });
    if (database === null) return [];
    try {
      if (!database.objectStoreNames.contains("thread")) return [];
      const keys = database.transaction("thread", "readonly").objectStore("thread").getAllKeys();
      return await new Promise<Array<string>>((resolve) => {
        keys.addEventListener("success", () => resolve(keys.result.map(String)));
      });
    } finally {
      database.close();
    }
  });
}

/** Waits until the client has persisted every one of `threadIds`; returns how many it holds. */
async function waitForPersisted(page: Page, threadIds: ReadonlyArray<string>): Promise<number> {
  const deadline = performance.now() + PERSIST_TIMEOUT_MS;
  while (true) {
    const keys = await cachedThreadKeys(page);
    const held = threadIds.filter((id) => keys.some((key) => key.endsWith(id))).length;
    if (held === threadIds.length || performance.now() > deadline) return held;
    await sleep(250);
  }
}

/** Clicks the sidebar row `key` and times the routed thread's rows and live marks from the click. */
export async function switchTo(page: Page, key: string, visit: Switch["visit"]): Promise<Switch> {
  await clearMarks(page, THREAD_MARK_PREFIX);
  const clicksBefore = (await readPageTimings(page)).clicks.length;
  await page.click(`[data-thread-item] [data-sidebar-row="${key}"]`);
  const rows = await waitForMark(page, `${THREAD_MARK_PREFIX}rows:`, ROWS_TIMEOUT_MS);
  const live = await waitForMark(page, `${THREAD_MARK_PREFIX}live`, LIVE_TIMEOUT_MS);
  const clickedAt = (await readPageTimings(page)).clicks[clicksBefore];
  if (clickedAt === undefined) throw new Error(`the click on thread ${key} was not observed`);
  await sleep(SETTLE_MS);
  const rowsMark = rows === null ? null : parseThreadMark(rows.name);
  return {
    threadId: threadIdOf(key),
    visit,
    rowsMs: rows === null ? null : rows.startTime - clickedAt,
    rowsStatus: rowsMark?.kind === "rows" ? rowsMark.status : null,
    liveMs: live === null ? null : live.startTime - clickedAt,
  };
}

const present = <A>(values: ReadonlyArray<A | null>) =>
  values.filter((value): value is A => value !== null);

export async function runThreadSwitch(ctx: ScenarioContext): Promise<ScenarioResult> {
  const notes: Array<string> = [];
  const context = await newMeasuredContext(ctx.browser, {
    cookies: ctx.cookies,
    motion: ctx.motion,
  });
  try {
    const page = await context.newPage();
    await loadUntilInteractive(page, () => page.goto(`${ctx.origin}/`, { waitUntil: "commit" }), 0);
    await waitForMark(page, "e6:startup:shell-live", 30_000);

    const rendered = await sidebarRowKeys(page);
    const seeded = rendered.filter((key) => threadIdOf(key).startsWith("perf-seed-thread-"));
    const longThreadRendered =
      ctx.seed.longThreadId !== null &&
      seeded.some((key) => threadIdOf(key) === ctx.seed.longThreadId);
    const chosen = seeded
      .filter((key) => threadIdOf(key) !== ctx.seed.longThreadId)
      .slice(0, THREADS);
    if (chosen.length < THREADS) {
      throw new Error(
        `the sidebar rendered ${chosen.length} short seeded threads of the ${THREADS} needed (${rendered.length} rows in all)`,
      );
    }

    const switches: Array<Switch> = [];
    for (const [index, key] of chosen.entries()) {
      ctx.log(`thread switch ${index + 1}/${THREADS} (first visit)`);
      switches.push(await switchTo(page, key, "first"));
    }
    let current = chosen.length - 1;
    for (let revisit = 0; revisit < REVISITS; revisit += 1) {
      // Steps by 3 through 10 threads, so consecutive switches never land on the open thread.
      current = (current + 3) % chosen.length;
      ctx.log(`thread switch ${revisit + 1}/${REVISITS} (revisit)`);
      switches.push(await switchTo(page, chosen[current]!, "revisit"));
    }

    const idle = await idleCheck(ctx.browser, page, {
      name: "threadSwitch.threadLive.idle",
      keepDir: ctx.traceDir,
    });
    const screenshots: Array<{ point: string; path: string }> = [];
    const shot = await screenshotIfStill(ctx, page, "threadSwitch.threadLive", idle);
    if ("taken" in shot) screenshots.push(shot.taken);
    else if (shot.skipped !== null) notes.push(shot.skipped);
    // Read before any reload: Event Timing entries belong to this document.
    const timings = await readPageTimings(page);

    const chosenIds = chosen.map(threadIdOf);
    const reloads: Array<{ readonly persisted: number; readonly routedThreadId: string }> = [];
    // Where an after-reload switch's first rows came from, read off the wire: the client
    // resumes a thread it holds in IndexedDB with `afterSequence` and loads no HTTP snapshot,
    // so a resume the server answered without a snapshot means the rows were the cached ones.
    const sources: Array<SwitchSource> = [];
    // The reload opens a new socket, which this capture sees from its first frame.
    const ws = await captureWsFrames(page);
    const httpSnapshots: Array<string> = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      const match = /^\/api\/orchestration\/threads\/([^/]+)$/.exec(url.pathname);
      if (match !== null && !url.searchParams.has("beforeCursor")) httpSnapshots.push(match[1]!);
    });
    let routedKey = chosen[current]!;
    while (
      switches.filter((entry) => entry.visit === "afterReload").length < CACHED_SWITCHES &&
      reloads.length < MAX_RELOADS
    ) {
      const persisted = await waitForPersisted(page, chosenIds);
      const routed = routedKey;
      reloads.push({ persisted, routedThreadId: threadIdOf(routed) });
      ctx.log(`reload ${reloads.length} (${persisted}/${chosenIds.length} threads cached)`);
      await loadUntilInteractive(page, () => page.reload({ waitUntil: "commit" }), 0);
      await waitForMark(page, "e6:startup:shell-live", 30_000);
      for (const key of chosen) {
        if (key === routed) continue;
        if (switches.filter((entry) => entry.visit === "afterReload").length >= CACHED_SWITCHES) {
          break;
        }
        ctx.log(`thread switch after reload ${reloads.length}`);
        const framesBefore = ws.frames.length;
        const httpBefore = httpSnapshots.length;
        switches.push(await switchTo(page, key, "afterReload"));
        const threadId = threadIdOf(key);
        const subscription = threadSubscriptions(ws.frames.slice(framesBefore)).find(
          (entry) => entry.threadId === threadId,
        );
        sources.push({
          threadId,
          resumedFromCache: subscription?.afterSequence != null,
          snapshotSent: subscription?.snapshot ?? false,
          httpSnapshot: httpSnapshots.slice(httpBefore).includes(threadId),
        });
        routedKey = key;
      }
    }
    await ws.stop();

    const revisits = switches.filter((entry) => entry.visit === "revisit");
    const firstVisits = switches.filter((entry) => entry.visit === "first");
    const afterReload = switches.filter((entry) => entry.visit === "afterReload");
    const metrics = threadSwitchMetrics({
      switches,
      afterReloadSources: sources,
      reloads: reloads.length,
    });
    const cachedRowsMs = metrics.find((metric) => metric.id === "web.threadSwitch.firstRows.cache");

    const fastestClamped = timings.clampProbe.length === 0 ? null : Math.min(...timings.clampProbe);
    notes.push(
      timings.firstInput.length > 0
        ? `event timing: first-input observed (${timings.firstInput[0]?.name}, ${timings.firstInput[0]?.duration} ms)`
        : "event timing: no first-input entry after the clicks",
      fastestClamped === null
        ? "event timing: an observer asking for a 0 ms threshold saw no entries"
        : `event timing: shortest entry with a 0 ms threshold requested was ${fastestClamped} ms (${fastestClamped >= 16 ? "nothing under 16 ms was reported" : "entries under 16 ms were reported"})`,
    );

    return {
      metrics,
      idlePoints: [idlePoint("threadSwitch.threadLive", idle)],
      screenshots,
      raw: {
        threads: chosen.map(threadIdOf),
        sidebarRows: rendered.length,
        longThreadRendered,
        firstVisit: {
          rowsMs: summarize(present(firstVisits.map((entry) => entry.rowsMs))),
          liveMs: summarize(present(firstVisits.map((entry) => entry.liveMs))),
          rowsStatuses: firstVisits.map((entry) => entry.rowsStatus),
        },
        revisit: {
          rowsMs: summarize(present(revisits.map((entry) => entry.rowsMs))),
          liveMs: summarize(present(revisits.map((entry) => entry.liveMs))),
          rowsStatuses: revisits.map((entry) => entry.rowsStatus),
        },
        afterReload: {
          reloads,
          rowsMs: summarize(present(afterReload.map((entry) => entry.rowsMs))),
          cachedRowsMs: summarize(
            cachedRowsMs?.kind === "measured"
              ? (cachedRowsMs.points ?? []).map((point) => point.value)
              : [],
          ),
          sources,
          liveMs: summarize(present(afterReload.map((entry) => entry.liveMs))),
          rowsStatuses: afterReload.map((entry) => entry.rowsStatus),
        },
        switches,
        idle,
        eventTiming: {
          firstInput: timings.firstInput,
          eventsOver16Ms: timings.events.length,
          shortestWithZeroThreshold: fastestClamped,
        },
      },
      validity: {
        eventTimingObserved: timings.firstInput.length > 0,
        notes,
      },
    };
  } finally {
    await context.close();
  }
}
