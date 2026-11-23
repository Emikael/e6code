/**
 * Scrolling the seeded 1,000-turn thread (plan §4.4). The client loads the
 * last 10 user turns and then 20 more each time the "Load earlier turns"
 * button at the top of the timeline is pressed; scrolling alone loads
 * nothing. So the paging window (20 s, traced) scrolls up with synthetic
 * mouse-wheel gestures and presses the button whenever it is on screen and
 * idle, as a reader would. Then, unmeasured, the harness keeps paging from
 * the top until every turn is loaded or 60 s pass. The loaded-range window
 * (traced) scrolls down from the top for 10 s and back up for 10 s at a fixed
 * speed. Both windows are reported; the frames row uses the loaded one.
 *
 * @module perf-harness/scenarios/timelineScroll
 */
import type { Page, Request, Response } from "playwright-core";

import {
  idleCheck,
  newMeasuredContext,
  readPageTimings,
  scrollGesture,
  sleep,
  traced,
  waitForMark,
} from "../browser.ts";
import type { MetricOutcome } from "../report.ts";
import { classifyFrames, type TraceEvent } from "../traceFrames.ts";
import { loadUntilInteractive } from "./coldLoad.ts";
import {
  idlePoint,
  screenshotIfStill,
  type ScenarioContext,
  type ScenarioResult,
} from "./scenario.ts";
import { sidebarRowKeys, switchTo, threadIdOf } from "./threadSwitch.ts";

const PAGING_WINDOW_MS = 20_000;
const PRE_PAGE_LIMIT_MS = 60_000;
const LOADED_LEG_MS = 10_000;
const GESTURE_PX = 1_200;
const GESTURE_SPEED_PX_PER_S = 2_400;
/** Synthesized gestures, then one wheel fallback, before the scenario gives up on scrolling. */
const PROBE_ATTEMPTS = 4;
const INITIAL_TURNS = 10;
const LOAD_EARLIER = "Load earlier turns";
const PAGE_LOAD_TIMEOUT_MS = 30_000;
const SETTLE_LIMIT_MS = 10_000;
// Frame reports and the timeline only: with the full set (input latency under "benchmark", the
// detailed timeline) a 20 s window writes ~100 MB, and tracing overhead lands in the frames being
// measured. Long tasks come from the page's observer, so the trace needs no task events.
const SCROLL_TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "blink.user_timing",
];

interface Viewport {
  readonly x: number;
  readonly y: number;
}

interface ListState {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  /** The "Load earlier turns" button: absent, loading, or ready with its centre on screen or not. */
  readonly button:
    | { readonly state: "absent" }
    | { readonly state: "loading" }
    | {
        readonly state: "ready";
        readonly onScreen: boolean;
        readonly x: number;
        readonly y: number;
      };
}

/** The page globals the scroll helpers read, evaluated in the page. */
interface ScrollDom {
  readonly document: {
    querySelector(selector: string): ScrollElement | null;
    querySelectorAll(selector: string): ArrayLike<ScrollElement>;
  };
  getComputedStyle(element: ScrollElement): { readonly overflowY: string };
}

interface ScrollElement {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly parentElement: ScrollElement | null;
  readonly textContent: string | null;
  readonly disabled?: boolean;
  getBoundingClientRect(): {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
  };
}

/** Reads the timeline's scroll container and its "Load earlier turns" button. */
function listState(page: Page): Promise<ListState | null> {
  return page.evaluate((label) => {
    const global = globalThis as unknown as ScrollDom;
    const row = global.document.querySelector("[data-timeline-root]");
    let scroller = row?.parentElement ?? null;
    while (scroller !== null) {
      const overflow = global.getComputedStyle(scroller).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && scroller.scrollHeight > 0) break;
      scroller = scroller.parentElement;
    }
    if (scroller === null) return null;
    const buttons = Array.from(global.document.querySelectorAll("button"));
    const button = buttons.find((element) => {
      const text = element.textContent ?? "";
      return text.startsWith(label) || text.startsWith("Loading earlier turns");
    });
    const box = scroller.getBoundingClientRect();
    let state: ListState["button"] = { state: "absent" };
    if (button !== undefined) {
      if (button.disabled === true) {
        state = { state: "loading" };
      } else {
        const rect = button.getBoundingClientRect();
        const y = (rect.top + rect.bottom) / 2;
        state = {
          state: "ready",
          onScreen: y > box.top && y < box.bottom,
          x: (rect.left + rect.right) / 2,
          y,
        };
      }
    }
    return {
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      button: state,
    };
  }, LOAD_EARLIER);
}

const distanceFromBottom = (state: ListState) =>
  state.scrollHeight - state.scrollTop - state.clientHeight;

/** Moves the timeline's scroll container to `to` at once (unmeasured jumps only). */
function jumpTo(page: Page, to: "top" | "bottom"): Promise<void> {
  return page.evaluate((target) => {
    const global = globalThis as unknown as ScrollDom;
    let scroller = global.document.querySelector("[data-timeline-root]")?.parentElement ?? null;
    while (scroller !== null) {
      const overflow = global.getComputedStyle(scroller).overflowY;
      if (overflow === "auto" || overflow === "scroll") break;
      scroller = scroller.parentElement;
    }
    if (scroller !== null) scroller.scrollTop = target === "top" ? 0 : scroller.scrollHeight;
  }, to);
}

/** Waits until an older page that is loading has merged, or the button went away. */
async function waitForPageMerged(page: Page): Promise<ListState | null> {
  const deadline = performance.now() + PAGE_LOAD_TIMEOUT_MS;
  while (performance.now() < deadline) {
    const state = await listState(page);
    if (state === null || state.button.state !== "loading") return state;
    await sleep(100);
  }
  throw new Error(`an older page did not load within ${PAGE_LOAD_TIMEOUT_MS} ms`);
}

/**
 * Jumps to the bottom until the list stops re-measuring: the scroll position
 * and height unchanged for a second, so the idle check that follows sees the
 * page, not the jump. Returns how long that took, or null if it never settled.
 */
async function settleAtBottom(page: Page): Promise<number | null> {
  const startedAt = performance.now();
  let previous: ListState | null = null;
  let stableSince = performance.now();
  while (performance.now() - startedAt < SETTLE_LIMIT_MS) {
    await jumpTo(page, "bottom");
    await sleep(250);
    const state = await listState(page);
    const moved =
      state === null ||
      previous === null ||
      state.scrollTop !== previous.scrollTop ||
      state.scrollHeight !== previous.scrollHeight;
    if (moved) stableSince = performance.now();
    else if (performance.now() - stableSince >= 1_000) return performance.now() - startedAt;
    previous = state;
  }
  return null;
}

/** User turns in a thread snapshot page response; null when the body is unavailable. */
async function turnsInPage(response: Response): Promise<number | null> {
  try {
    const body = (await response.json()) as {
      readonly thread?: { readonly messages?: ReadonlyArray<{ readonly role?: string }> };
    };
    return (body.thread?.messages ?? []).filter((message) => message.role === "user").length;
  } catch {
    return null;
  }
}

function frameWindow(events: ReadonlyArray<TraceEvent>) {
  const frames = classifyFrames(events);
  return {
    withinBudgetFraction: frames.withinBudgetFraction,
    counts: frames.counts,
    source: frames.source,
    presentationIntervalsMs: frames.presentationIntervalsMs,
  };
}

export async function runTimelineScroll(ctx: ScenarioContext): Promise<ScenarioResult> {
  const notes: Array<string> = [];
  const longThreadId = ctx.seed.longThreadId;
  if (longThreadId === null) throw new Error("the seed has no long thread");
  const context = await newMeasuredContext(ctx.browser, {
    cookies: ctx.cookies,
    motion: ctx.motion,
  });
  try {
    const page = await context.newPage();
    const olderPages: Array<{ readonly request: Request; response: Response | null }> = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        url.pathname === `/api/orchestration/threads/${longThreadId}` &&
        url.searchParams.has("beforeCursor")
      ) {
        olderPages.push({ request, response: null });
      }
    });
    page.on("response", (response) => {
      const entry = olderPages.find((candidate) => candidate.request === response.request());
      if (entry !== undefined) entry.response = response;
    });

    await loadUntilInteractive(page, () => page.goto(`${ctx.origin}/`, { waitUntil: "commit" }), 0);
    await waitForMark(page, "e6:startup:shell-live", 30_000);
    const key = (await sidebarRowKeys(page)).find((entry) => threadIdOf(entry) === longThreadId);
    if (key === undefined) throw new Error(`the sidebar did not render the long thread`);
    const opened = await switchTo(page, key, "first");
    if (opened.rowsMs === null) throw new Error("the long thread showed no rows");
    const box = await page.locator("[data-assistant-citation-viewport]").first().boundingBox();
    if (box === null) throw new Error("the timeline has no viewport on screen");
    const viewport: Viewport = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(viewport.x, viewport.y);
    const session = await context.newCDPSession(page);
    const settledMs = await settleAtBottom(page);
    const initial = await listState(page);
    if (initial === null) throw new Error("the timeline has no scroll container");
    // Unmeasured gestures confirm that a positive distance scrolls toward older turns and
    // carry the list out of its pinned-to-end state, which can swallow a single gesture
    // while rows are still being measured. Movement is read as distance from the bottom:
    // rows measured or merged above the viewport raise scrollTop and scrollHeight together.
    const probes: Array<string> = [];
    let probed: ListState | null = initial;
    for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt++) {
      if (attempt < PROBE_ATTEMPTS - 1) {
        await scrollGesture(session, {
          x: viewport.x,
          y: viewport.y,
          yDistance: GESTURE_PX,
          speed: GESTURE_SPEED_PX_PER_S,
        });
      } else {
        await page.mouse.wheel(0, -GESTURE_PX);
      }
      probed = await listState(page);
      probes.push(probed === null ? "none" : String(distanceFromBottom(probed)));
      if (probed !== null && distanceFromBottom(probed) > distanceFromBottom(initial)) break;
    }
    if (probed === null || distanceFromBottom(probed) <= distanceFromBottom(initial)) {
      throw new Error(
        `scroll-up gestures did not move the timeline up (distance from bottom ${distanceFromBottom(initial)} -> ${probes.join(", ")}; settled at bottom ${settledMs === null ? "never" : `in ${Math.round(settledMs)} ms`})`,
      );
    }

    const pagingStartMs = await page.evaluate(() => performance.now());
    let pagingClicks = 0;
    let gestures = 0;
    const paging = await traced(
      ctx.browser,
      page,
      { name: "timelineScroll.paging", keepDir: ctx.traceDir, categories: SCROLL_TRACE_CATEGORIES },
      async () => {
        const endAt = performance.now() + PAGING_WINDOW_MS;
        while (performance.now() < endAt) {
          await scrollGesture(session, {
            x: viewport.x,
            y: viewport.y,
            yDistance: GESTURE_PX,
            speed: GESTURE_SPEED_PX_PER_S,
          });
          gestures += 1;
          const state = await listState(page);
          if (state?.button.state === "ready" && state.button.onScreen) {
            await page.mouse.click(state.button.x, state.button.y);
            await page.mouse.move(viewport.x, viewport.y);
            pagingClicks += 1;
          }
        }
      },
    );
    const pagingEndMs = await page.evaluate(() => performance.now());
    const afterPaging = await listState(page);
    const pagesInPagingWindow = olderPages.length;
    ctx.log(`paging window: ${gestures} gestures, ${pagingClicks} pages requested`);

    const prePageStartedAt = performance.now();
    let prePageClicks = 0;
    let state = await waitForPageMerged(page);
    while (state !== null && state.button.state !== "absent") {
      if (performance.now() - prePageStartedAt > PRE_PAGE_LIMIT_MS) break;
      await jumpTo(page, "top");
      const atTop = await listState(page);
      if (atTop?.button.state === "ready") {
        await page.mouse.click(atTop.button.x, atTop.button.y);
        prePageClicks += 1;
        await sleep(50);
      }
      state = await waitForPageMerged(page);
    }
    const prePageMs = performance.now() - prePageStartedAt;
    const allLoaded = state?.button.state === "absent";
    const turnsPerPage = await Promise.all(
      olderPages.map((entry) => (entry.response === null ? null : turnsInPage(entry.response))),
    );
    const pageTurns = (entries: ReadonlyArray<number | null>) =>
      entries.reduce<number>((sum, turns) => sum + (turns ?? 0), 0);
    const turnsAfterPaging = INITIAL_TURNS + pageTurns(turnsPerPage.slice(0, pagesInPagingWindow));
    const turnsLoaded = INITIAL_TURNS + pageTurns(turnsPerPage);
    ctx.log(
      `pre-paged ${prePageClicks} more pages in ${Math.round(prePageMs)} ms; ${turnsLoaded} turns loaded${allLoaded ? " (all)" : ""}`,
    );

    await jumpTo(page, "top");
    await page.mouse.move(viewport.x, viewport.y);
    const screenshots: Array<{ point: string; path: string }> = [];
    let topIdle: Awaited<ReturnType<typeof idleCheck>> | null = null;
    if (ctx.screenshots) {
      topIdle = await idleCheck(ctx.browser, page, {
        name: "timelineScroll.top.idle",
        keepDir: ctx.traceDir,
      });
      const shot = await screenshotIfStill(ctx, page, "timelineScroll.top", topIdle);
      if ("taken" in shot) screenshots.push(shot.taken);
      else if (shot.skipped !== null) notes.push(shot.skipped);
      await page.mouse.move(viewport.x, viewport.y);
    }

    const loadedStart = await listState(page);
    const loadedStartMs = await page.evaluate(() => performance.now());
    let turnaround: ListState | null = null;
    const loaded = await traced(
      ctx.browser,
      page,
      { name: "timelineScroll.loaded", keepDir: ctx.traceDir, categories: SCROLL_TRACE_CATEGORIES },
      async () => {
        for (const direction of [-1, 1] as const) {
          const endAt = performance.now() + LOADED_LEG_MS;
          while (performance.now() < endAt) {
            await scrollGesture(session, {
              x: viewport.x,
              y: viewport.y,
              yDistance: direction * GESTURE_PX,
              speed: GESTURE_SPEED_PX_PER_S,
            });
          }
          if (direction === -1) turnaround = await listState(page);
        }
      },
    );
    const loadedEndMs = await page.evaluate(() => performance.now());
    const loadedEnd = await listState(page);

    const bottomSettleMs = await settleAtBottom(page);
    const idle = await idleCheck(ctx.browser, page, {
      name: "timelineScroll.bottom.idle",
      keepDir: ctx.traceDir,
    });
    const shot = await screenshotIfStill(ctx, page, "timelineScroll.bottom", idle);
    if ("taken" in shot) screenshots.push(shot.taken);
    else if (shot.skipped !== null) notes.push(shot.skipped);

    const timings = await readPageTimings(page);
    const longTasksIn = (startMs: number, endMs: number) =>
      timings.longTasks
        .filter((task) => task.start >= startMs && task.start <= endMs)
        .map((task) => task.duration);
    const pagingLongTasks = longTasksIn(pagingStartMs, pagingEndMs);
    const loadedLongTasks = longTasksIn(loadedStartMs, loadedEndMs);
    const pagingFrames = frameWindow(paging.events);
    const loadedFrames = frameWindow(loaded.events);
    const allLongTasks = [...pagingLongTasks, ...loadedLongTasks];
    const counted = loadedFrames.counts.presentedAll + loadedFrames.counts.presentedPartial;

    const metrics: Array<MetricOutcome> = [
      loadedFrames.withinBudgetFraction === null
        ? {
            kind: "notMeasured",
            id: "web.timeline.scroll.framesWithinBudget",
            reason: `the loaded-range trace held no presented or dropped frames (source ${loadedFrames.source})`,
          }
        : {
            kind: "measured",
            id: "web.timeline.scroll.framesWithinBudget",
            unit: "fraction",
            statistic: "fraction",
            value: loadedFrames.withinBudgetFraction,
            samples: counted + loadedFrames.counts.dropped,
            source: `cdp-trace:${loadedFrames.source} presented over presented+dropped, loaded-range window (${LOADED_LEG_MS / 1000} s down, ${LOADED_LEG_MS / 1000} s up, ${GESTURE_SPEED_PX_PER_S} px/s mouse gestures)`,
            flags: [
              `pagingWindowFraction:${pagingFrames.withinBudgetFraction ?? "none"}`,
              `turnsLoaded:${turnsLoaded}${allLoaded ? "" : "(partial)"}`,
            ],
          },
      {
        kind: "measured",
        id: "web.timeline.scroll.longTaskMax",
        unit: "ms",
        statistic: "max",
        value: allLongTasks.length === 0 ? 0 : Math.max(...allLongTasks),
        samples: allLongTasks.length,
        source: "longtask observer over the paging and loaded-range windows",
        flags: [
          `pagingWindowMaxMs:${pagingLongTasks.length === 0 ? 0 : Math.max(...pagingLongTasks)}`,
          `loadedWindowMaxMs:${loadedLongTasks.length === 0 ? 0 : Math.max(...loadedLongTasks)}`,
          ...(allLongTasks.length === 0 ? ["noLongTasks"] : []),
        ],
      },
    ];

    return {
      metrics,
      idlePoints: [idlePoint("timelineScroll.bottom", idle)],
      screenshots,
      raw: {
        threadId: longThreadId,
        paging: {
          windowMs: pagingEndMs - pagingStartMs,
          gestures,
          pagesRequested: pagesInPagingWindow,
          buttonPresses: pagingClicks,
          turnsRendered: turnsAfterPaging,
          ...pagingFrames,
          longTasksMs: pagingLongTasks,
          traceBytes: paging.traceBytes,
          scrollTop: {
            beforeProbe: initial.scrollTop,
            afterProbe: probed.scrollTop,
            after: afterPaging?.scrollTop ?? null,
          },
        },
        prePage: {
          ms: prePageMs,
          buttonPresses: prePageClicks,
          pagesRequested: olderPages.length - pagesInPagingWindow,
          limitMs: PRE_PAGE_LIMIT_MS,
          allLoaded,
        },
        turnsLoaded,
        turnsPerPage,
        pageStatuses: olderPages.map((entry) => entry.response?.status() ?? null),
        loaded: {
          windowMs: loadedEndMs - loadedStartMs,
          ...loadedFrames,
          longTasksMs: loadedLongTasks,
          traceBytes: loaded.traceBytes,
          scroll: {
            start: loadedStart,
            turnaround,
            end: loadedEnd,
          },
        },
        gesture: { px: GESTURE_PX, speedPxPerSecond: GESTURE_SPEED_PX_PER_S, source: "mouse" },
        topIdle,
        bottomSettleMs,
        idle,
      },
      validity: { notes },
    };
  } finally {
    await context.close();
  }
}
