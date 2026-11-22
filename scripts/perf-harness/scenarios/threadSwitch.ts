// @effect-diagnostics nodeBuiltinImport:off - names screenshot files under the out directory.
/**
 * Thread switch (plan §4.2). One page opens the app, then clicks ten seeded
 * threads in the sidebar once each (first visits, empty cache) and switches
 * among them twenty more times. Each switch runs from the click's
 * `event.timeStamp` to the `e6:thread:rows:*` and `e6:thread:live` marks the
 * chat view sets for the routed thread. The idle check and screenshot run on
 * the last thread once it is live.
 *
 * @module perf-harness/scenarios/threadSwitch
 */
import * as NodePath from "node:path";

import { parseThreadMark, THREAD_MARK_PREFIX } from "@e6tools/shared/threadMarks";
import type { Page } from "playwright-core";

import {
  clearMarks,
  idleCheck,
  newMeasuredContext,
  readPageTimings,
  screenshot,
  sleep,
  waitForMark,
  type PageGlobal,
} from "../browser.ts";
import type { MetricOutcome } from "../report.ts";
import { percentile, summarize } from "../stats.ts";
import { loadUntilInteractive } from "./coldLoad.ts";
import { screenshotName, type ScenarioContext, type ScenarioResult } from "./scenario.ts";

const THREADS = 10;
const REVISITS = 20;
const ROWS_TIMEOUT_MS = 15_000;
const LIVE_TIMEOUT_MS = 20_000;
// Lets the switched-to thread finish its follow-up work before the next click.
const SETTLE_MS = 300;

interface Switch {
  readonly threadId: string;
  readonly visit: "first" | "revisit";
  readonly rowsMs: number | null;
  readonly rowsStatus: string | null;
  readonly liveMs: number | null;
}

/** Sidebar row keys (`<environmentId>:<threadId>`) in the order the sidebar renders them. */
function sidebarRowKeys(page: Page): Promise<Array<string>> {
  return page.evaluate(() =>
    Array.from(
      (globalThis as unknown as PageGlobal).document.querySelectorAll(
        "[data-thread-item] [data-sidebar-row]",
      ),
      (element) => element.getAttribute("data-sidebar-row") ?? "",
    ).filter((key) => key.length > 0),
  );
}

const threadIdOf = (key: string) => key.slice(key.indexOf(":") + 1);

async function switchTo(page: Page, key: string, visit: Switch["visit"]): Promise<Switch> {
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
    if (ctx.screenshots) {
      if (idle.framesWithUpdate === 0) {
        const path = NodePath.join(
          ctx.outDir,
          screenshotName("threadSwitch.threadLive", ctx.motion),
        );
        await screenshot(page, path);
        screenshots.push({ point: "threadSwitch.threadLive", path });
      } else {
        notes.push(
          `threadSwitch.threadLive screenshot skipped: ${idle.framesWithUpdate} frames at idle`,
        );
      }
    }
    const timings = await readPageTimings(page);

    const revisits = switches.filter((entry) => entry.visit === "revisit");
    const firstVisits = switches.filter((entry) => entry.visit === "first");
    const revisitRows = present(revisits.map((entry) => entry.rowsMs));
    const revisitLive = present(revisits.map((entry) => entry.liveMs));
    // Only rows shown from the client cache answer "first rows from cache"; a revisited thread
    // that is still live shows rows:live, which is a different path.
    const cachedRows = present(
      revisits.filter((entry) => entry.rowsStatus === "cached").map((entry) => entry.rowsMs),
    );
    const statusCounts = new Map<string, number>();
    for (const entry of revisits) {
      const status = entry.rowsStatus ?? "absent";
      statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    }
    const statusSummary = [...statusCounts.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) => `${status}=${count}`)
      .join(",");
    const statusFlags = [`revisitRowsStatus:${statusSummary}`];

    const metrics: Array<MetricOutcome> = [
      cachedRows.length > 0
        ? {
            kind: "measured",
            id: "web.threadSwitch.firstRows.cache",
            unit: "ms",
            statistic: "p95",
            value: percentile(cachedRows, 0.95) ?? Number.NaN,
            samples: cachedRows.length,
            source: "click event.timeStamp to mark e6:thread:rows:cached on revisits",
            flags: statusFlags,
          }
        : {
            kind: "notMeasured",
            id: "web.threadSwitch.firstRows.cache",
            reason: `mark absent: no revisit showed e6:thread:rows:cached (${statusSummary} of ${revisits.length} revisits)`,
            flags: statusFlags,
          },
      revisitLive.length === revisits.length
        ? {
            kind: "measured",
            id: "web.threadSwitch.firstRows.live",
            unit: "ms",
            statistic: "p95",
            value: percentile(revisitLive, 0.95) ?? Number.NaN,
            samples: revisitLive.length,
            source: "click event.timeStamp to mark e6:thread:live on revisits",
            flags: statusFlags,
          }
        : {
            kind: "notMeasured",
            id: "web.threadSwitch.firstRows.live",
            reason: `mark absent on ${revisits.length - revisitLive.length} of ${revisits.length} revisits`,
            flags: statusFlags,
          },
    ];

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
      idlePoints: [{ label: "threadSwitch.threadLive", value: idle.framesWithUpdate }],
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
          rowsMs: summarize(revisitRows),
          liveMs: summarize(revisitLive),
          rowsStatuses: revisits.map((entry) => entry.rowsStatus),
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
