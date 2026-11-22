// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - drives headless Chromium through Playwright and reads traces from disk.
/**
 * The browser side of the web performance harness: headless Chromium through
 * `playwright-core` at 1440×900 and DPR 1, an init script that records
 * performance entries into `window.__e6perf` and seeds the Motion setting,
 * windowed CDP tracing, and the idle and frame-cadence checks.
 *
 * Functions handed to `page.evaluate` run in the page, so each one names the
 * page globals it reads through `PageGlobal` instead of the DOM library.
 *
 * @module perf-harness/browser
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Cookie,
  type Page,
} from "playwright-core";

import type { WsFrame } from "./wsFrames.ts";
import { classifyFrames, idleFrameActivity, type TraceEvent } from "./traceFrames.ts";

export type MotionRequest = "full" | "reduced" | "off";

export const VIEWPORT = { width: 1440, height: 900, dpr: 1 } as const;

const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "blink.user_timing",
  "loading",
  "benchmark",
  "v8.execute",
];

export interface MarkHit {
  readonly name: string;
  readonly startTime: number;
}

interface PerfProbe {
  readonly clicks: Array<number>;
  readonly longTasks: Array<{ readonly start: number; readonly duration: number }>;
  readonly events: Array<{
    readonly name: string;
    readonly start: number;
    readonly duration: number;
  }>;
  /** Durations from an observer asking for a 0 ms threshold, to see whether 16 ms is enforced. */
  readonly clampProbe: Array<number>;
  readonly longAnimationFrames: Array<{
    readonly start: number;
    readonly duration: number;
    readonly blockingDuration: number;
  }>;
  readonly firstInput: Array<{ readonly name: string; readonly duration: number }>;
  readonly waitForMark: (prefix: string, timeoutMs: number) => Promise<MarkHit | null>;
}

interface ObservedEntry {
  readonly name: string;
  readonly entryType: string;
  readonly startTime: number;
  readonly duration: number;
  readonly initiatorType?: string;
  readonly transferSize?: number;
  readonly blockingDuration?: number;
}

export interface PageGlobal {
  __e6perf?: PerfProbe;
  readonly localStorage: {
    setItem(key: string, value: string): void;
    getItem(key: string): string | null;
  };
  readonly PerformanceObserver: new (
    callback: (list: { getEntries(): Array<ObservedEntry> }) => void,
  ) => { observe(options: Record<string, unknown>): void };
  readonly performance: {
    getEntriesByType(type: string): Array<ObservedEntry>;
    clearMarks(name?: string): void;
    setResourceTimingBufferSize?(size: number): void;
  };
  readonly addEventListener: (
    type: string,
    listener: (event: { readonly timeStamp: number }) => void,
    options: { readonly capture: boolean },
  ) => void;
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly document: {
    readonly activeElement: { blur?: () => void } | null;
    readonly fonts: { readonly ready: Promise<unknown> };
    readonly documentElement: { readonly dataset: Record<string, string | undefined> };
    querySelectorAll(selector: string): ArrayLike<{ getAttribute(name: string): string | null }>;
  };
}

/** Runs in every document before its scripts. Must stay self-contained. */
function installPerfProbe(clientSettings: string) {
  const RESOURCE_BUFFER = 2_000;
  const page = globalThis as unknown as PageGlobal;
  if (page.__e6perf !== undefined) return;
  const waiters: Array<{ prefix: string; resolve: (hit: MarkHit | null) => void }> = [];
  const probe: PerfProbe = {
    clicks: [],
    longTasks: [],
    events: [],
    clampProbe: [],
    longAnimationFrames: [],
    firstInput: [],
    waitForMark: (prefix, timeoutMs) =>
      new Promise((resolve) => {
        const existing = page.performance
          .getEntriesByType("mark")
          .find((entry) => entry.name.startsWith(prefix));
        if (existing !== undefined) {
          resolve({ name: existing.name, startTime: existing.startTime });
          return;
        }
        const waiter = { prefix, resolve };
        waiters.push(waiter);
        page.setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index === -1) return;
          waiters.splice(index, 1);
          resolve(null);
        }, timeoutMs);
      }),
  };
  page.__e6perf = probe;
  // The default buffer holds 250 resources; a cold load fetches well over 100 scripts.
  page.performance.setResourceTimingBufferSize?.(RESOURCE_BUFFER);
  try {
    // Throws on data: and about:blank documents, which have no storage.
    page.localStorage.setItem("e6code:client-settings:v1", clientSettings);
  } catch {
    // No storage, nothing to seed.
  }
  const observe = (options: Record<string, unknown>, sink: (entry: ObservedEntry) => void) => {
    try {
      new page.PerformanceObserver((list) => {
        for (const entry of list.getEntries()) sink(entry);
      }).observe({ buffered: true, ...options });
    } catch {
      // An entry type this browser does not support.
    }
  };
  observe({ type: "longtask" }, (entry) =>
    probe.longTasks.push({ start: entry.startTime, duration: entry.duration }),
  );
  observe({ type: "event", durationThreshold: 16 }, (entry) =>
    probe.events.push({ name: entry.name, start: entry.startTime, duration: entry.duration }),
  );
  observe({ type: "event", durationThreshold: 0 }, (entry) =>
    probe.clampProbe.push(entry.duration),
  );
  observe({ type: "long-animation-frame" }, (entry) =>
    probe.longAnimationFrames.push({
      start: entry.startTime,
      duration: entry.duration,
      blockingDuration: entry.blockingDuration ?? 0,
    }),
  );
  observe({ type: "first-input" }, (entry) =>
    probe.firstInput.push({ name: entry.name, duration: entry.duration }),
  );
  observe({ type: "mark" }, (entry) => {
    const matched = waiters.filter((waiter) => entry.name.startsWith(waiter.prefix));
    for (const waiter of matched) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve({ name: entry.name, startTime: entry.startTime });
    }
  });
  page.addEventListener("click", (event) => probe.clicks.push(event.timeStamp), { capture: true });
}

export interface BrowserInfo {
  readonly binary: string;
  readonly revision: string | null;
  readonly version: string | null;
}

const INSTALL_HINT =
  "pnpm --filter @e6tools/scripts exec playwright-core install --only-shell chromium";

/** Launches the cached headless shell; never downloads one. */
export async function launchBrowser(): Promise<{ browser: Browser; info: BrowserInfo }> {
  let browser: Browser;
  try {
    // The harness's own SIGINT/SIGTERM trap closes the browser after stopping its servers;
    // Playwright's handlers would exit the process before those servers are down.
    browser = await chromium.launch({
      headless: true,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Executable doesn't exist")) {
      throw new Error(
        `Chromium headless shell is not installed. Install it with:\n  ${INSTALL_HINT}`,
        { cause: error },
      );
    }
    throw error;
  }
  const browsersJson = NodePath.join(
    NodePath.dirname(new URL(import.meta.resolve("playwright-core/package.json")).pathname),
    "browsers.json",
  );
  const revision = await NodeFSP.readFile(browsersJson, "utf8")
    .then((text) => {
      const parsed = JSON.parse(text) as {
        readonly browsers?: ReadonlyArray<{ readonly name: string; readonly revision: string }>;
      };
      return parsed.browsers?.find((entry) => entry.name === "chromium-headless-shell")?.revision;
    })
    .catch(() => undefined);
  return {
    browser,
    info: { binary: "headless-shell", revision: revision ?? null, version: browser.version() },
  };
}

/** A context with only `cookies` carried over: empty HTTP cache, storage and IndexedDB. */
export async function newMeasuredContext(
  browser: Browser,
  input: { readonly cookies: ReadonlyArray<Cookie>; readonly motion: MotionRequest },
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    deviceScaleFactor: VIEWPORT.dpr,
    reducedMotion: input.motion === "full" ? "no-preference" : "reduce",
    storageState: { cookies: [...input.cookies], origins: [] },
  });
  await context.addInitScript(installPerfProbe, JSON.stringify({ motion: input.motion }));
  return context;
}

/** Records a CDP trace around `run`; writes it under `keepDir` when given. */
export async function traced<A>(
  browser: Browser,
  page: Page,
  input: {
    readonly name: string;
    readonly keepDir: string | null;
    readonly categories?: ReadonlyArray<string>;
  },
  run: () => Promise<A>,
): Promise<{
  readonly result: A;
  readonly events: Array<TraceEvent>;
  readonly traceBytes: number;
}> {
  await browser.startTracing(page, { categories: [...(input.categories ?? TRACE_CATEGORIES)] });
  let buffer: Buffer | null = null;
  let result: A;
  try {
    result = await run();
  } finally {
    buffer = await browser.stopTracing();
    if (input.keepDir !== null) {
      await NodeFSP.mkdir(input.keepDir, { recursive: true });
      await NodeFSP.writeFile(NodePath.join(input.keepDir, `${input.name}.json`), buffer);
    }
  }
  const parsed = JSON.parse(buffer.toString("utf8")) as {
    readonly traceEvents?: Array<TraceEvent>;
  };
  return { result, events: parsed.traceEvents ?? [], traceBytes: buffer.length };
}

/** The first mark in this document whose name starts with `prefix`, or `null` after `timeoutMs`. */
export function waitForMark(
  page: Page,
  prefix: string,
  timeoutMs: number,
): Promise<MarkHit | null> {
  return page.evaluate(
    ([markPrefix, timeout]) =>
      (globalThis as unknown as PageGlobal).__e6perf?.waitForMark(markPrefix, timeout) ??
      Promise.resolve(null),
    [prefix, timeoutMs] as const,
  );
}

export interface PageTimings {
  readonly marks: ReadonlyArray<MarkHit>;
  readonly paints: Record<string, number>;
  readonly scripts: ReadonlyArray<string>;
  /** All resource entries; at the buffer size, scripts may be missing. */
  readonly resourceEntries: number;
  readonly clicks: ReadonlyArray<number>;
  readonly events: ReadonlyArray<{
    readonly name: string;
    readonly start: number;
    readonly duration: number;
  }>;
  readonly clampProbe: ReadonlyArray<number>;
  readonly firstInput: ReadonlyArray<{ readonly name: string; readonly duration: number }>;
  readonly longTasks: ReadonlyArray<{ readonly start: number; readonly duration: number }>;
  readonly longAnimationFrames: PerfProbe["longAnimationFrames"];
  readonly motion: string | null;
  /** The Motion setting stored in client settings after boot, to see the seed survived. */
  readonly storedMotion: string | null;
}

export function readPageTimings(page: Page): Promise<PageTimings> {
  return page.evaluate(() => {
    const global = globalThis as unknown as PageGlobal;
    const probe = global.__e6perf;
    return {
      marks: global.performance
        .getEntriesByType("mark")
        .map((entry) => ({ name: entry.name, startTime: entry.startTime })),
      paints: Object.fromEntries(
        global.performance.getEntriesByType("paint").map((entry) => [entry.name, entry.startTime]),
      ),
      resourceEntries: global.performance.getEntriesByType("resource").length,
      scripts: global.performance
        .getEntriesByType("resource")
        .filter((entry) => entry.initiatorType === "script" || entry.name.endsWith(".js"))
        .map((entry) => entry.name),
      clicks: [...(probe?.clicks ?? [])],
      events: (probe?.events ?? []).map((entry) => ({
        name: entry.name,
        start: entry.start,
        duration: entry.duration,
      })),
      clampProbe: [...(probe?.clampProbe ?? [])],
      firstInput: [...(probe?.firstInput ?? [])],
      longTasks: [...(probe?.longTasks ?? [])],
      longAnimationFrames: [...(probe?.longAnimationFrames ?? [])],
      motion: global.document.documentElement.dataset.motion ?? null,
      storedMotion: (() => {
        try {
          const stored = JSON.parse(
            global.localStorage.getItem("e6code:client-settings:v1") ?? "null",
          ) as { readonly motion?: unknown } | null;
          return typeof stored?.motion === "string" ? stored.motion : null;
        } catch {
          return null;
        }
      })(),
    };
  });
}

/**
 * Records the page's WebSocket text frames over CDP. `Network.enable` reports
 * only sockets opened after it, so call this before navigating.
 */
export async function captureWsFrames(page: Page): Promise<{
  readonly frames: Array<WsFrame>;
  /** The first frame from `fromIndex` on that `matches`, waiting up to `timeoutMs`. */
  readonly waitForFrame: (
    fromIndex: number,
    matches: (frame: WsFrame) => boolean,
    timeoutMs: number,
  ) => Promise<number | null>;
  readonly stop: () => Promise<void>;
}> {
  const session = await page.context().newCDPSession(page);
  const frames: Array<WsFrame> = [];
  const waiters = new Set<() => void>();
  const record = (frame: WsFrame) => {
    frames.push(frame);
    for (const wake of waiters) wake();
  };
  session.on("Network.webSocketFrameSent", (event) => {
    if (event.response.opcode === 1) {
      record({
        socket: event.requestId,
        direction: "sent",
        timestampMs: event.timestamp * 1000,
        payload: event.response.payloadData,
      });
    }
  });
  session.on("Network.webSocketFrameReceived", (event) => {
    if (event.response.opcode === 1) {
      record({
        socket: event.requestId,
        direction: "received",
        timestampMs: event.timestamp * 1000,
        payload: event.response.payloadData,
      });
    }
  });
  await session.send("Network.enable");
  const find = (fromIndex: number, matches: (frame: WsFrame) => boolean) => {
    for (let index = fromIndex; index < frames.length; index += 1) {
      if (matches(frames[index]!)) return index;
    }
    return null;
  };
  return {
    frames,
    waitForFrame: (fromIndex, matches, timeoutMs) => {
      const found = find(fromIndex, matches);
      if (found !== null) return Promise.resolve(found);
      return new Promise((resolve) => {
        let scanned = frames.length;
        const wake = () => {
          const next = find(scanned, matches);
          scanned = frames.length;
          if (next === null) return;
          clearTimeout(timer);
          waiters.delete(wake);
          resolve(next);
        };
        const timer = setTimeout(() => {
          waiters.delete(wake);
          resolve(null);
        }, timeoutMs);
        waiters.add(wake);
      });
    },
    stop: () => session.detach().catch(() => undefined),
  };
}

/**
 * Renderer heap after a forced major GC, over CDP. Forcing GC disturbs the
 * page, so call it only at sample points, never inside a latency window.
 */
export async function heapAfterGc(
  page: Page,
): Promise<{ readonly usedBytes: number; readonly totalBytes: number }> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("HeapProfiler.collectGarbage");
    const usage = await session.send("Runtime.getHeapUsage");
    return { usedBytes: usage.usedSize, totalBytes: usage.totalSize };
  } finally {
    await session.detach().catch(() => undefined);
  }
}

/**
 * A synthetic scroll gesture at (`x`, `y`) through the input pipeline Chromium's
 * smoothness benchmarks use; positive `yDistance` scrolls up. Resolves when the
 * gesture has finished.
 */
export async function scrollGesture(
  session: CDPSession,
  input: {
    readonly x: number;
    readonly y: number;
    readonly yDistance: number;
    readonly speed: number;
  },
): Promise<void> {
  await session.send("Input.synthesizeScrollGesture", {
    x: input.x,
    y: input.y,
    yDistance: input.yDistance,
    speed: input.speed,
    gestureSourceType: "mouse",
    preventFling: true,
  });
}

/** Clears the marks whose names start with `prefix`. */
export function clearMarks(page: Page, prefix: string): Promise<void> {
  return page.evaluate((markPrefix) => {
    const global = globalThis as unknown as PageGlobal;
    for (const entry of global.performance.getEntriesByType("mark")) {
      if (entry.name.startsWith(markPrefix)) global.performance.clearMarks(entry.name);
    }
  }, prefix);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Blurs the focused element and parks the pointer, so neither a caret nor a hover paints. */
async function settleForIdle(page: Page): Promise<void> {
  await page.evaluate(() => {
    (globalThis as unknown as PageGlobal).document.activeElement?.blur?.();
  });
  await page.mouse.move(0, 0);
}

/**
 * The "still at idle" check (§4.7): settle, wait 1 s, then count frames over a
 * 5 s trace. Counted from the trace, so the page is not asked for frames.
 */
export async function idleCheck(
  browser: Browser,
  page: Page,
  input: { readonly name: string; readonly keepDir: string | null },
): Promise<{
  readonly framesWithUpdate: number;
  readonly mainThreadFrames: number;
  readonly rendererMainEvents: number;
  readonly source: string;
}> {
  await settleForIdle(page);
  await sleep(1_000);
  const { events } = await traced(browser, page, input, () => sleep(5_000));
  return idleFrameActivity(events);
}

/** Writes a screenshot once web fonts have loaded; outside any measurement window. */
export async function screenshot(page: Page, path: string): Promise<void> {
  await page.evaluate(async () => {
    await (globalThis as unknown as PageGlobal).document.fonts.ready;
  });
  await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
  await page.screenshot({ path });
}

const PROBE_PAGE = `<!doctype html><style>
@keyframes slide { from { transform: translateX(0) } to { transform: translateX(200px) } }
div { width: 48px; height: 48px; background: #888; animation: slide 1s linear infinite alternate }
</style><div></div>`;

/**
 * The frame-cadence probe (§7.2): a page with one CSS animation, traced for
 * 2 s. A median presentation interval near 16.7 ms means frame metrics from
 * this browser can be trusted.
 */
export async function frameCadenceProbe(
  browser: Browser,
  keepDir: string | null,
): Promise<{
  readonly p50Ms: number | null;
  readonly frames: number;
  readonly source: string;
}> {
  const context = await browser.newContext({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    deviceScaleFactor: VIEWPORT.dpr,
  });
  try {
    const page = await context.newPage();
    await page.goto(`data:text/html,${encodeURIComponent(PROBE_PAGE)}`);
    await sleep(300);
    const { events } = await traced(browser, page, { name: "frame-cadence", keepDir }, () =>
      sleep(2_000),
    );
    const summary = classifyFrames(events);
    return {
      p50Ms: summary.presentationIntervalsMs?.p50 ?? null,
      frames: summary.counts.presentedAll + summary.counts.presentedPartial,
      source: summary.source,
    };
  } finally {
    await context.close();
  }
}

export { sleep };
