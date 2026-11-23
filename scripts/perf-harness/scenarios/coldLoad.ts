/**
 * Cold load (plan §4.1). Five local cold loads, each a new context carrying
 * only the session cookie, traced from navigation to 2 s after the shell is
 * interactive: paint timing, boot script time and the scripts fetched. Then
 * the remote profile through the throttle proxy (60 ms RTT, 20 Mbps): three
 * cold loads and three warm reloads in the last cold context. The "still at
 * idle" check and screenshot run once, after the last local load.
 *
 * @module perf-harness/scenarios/coldLoad
 */
import {
  ORCHESTRATION_PROTOCOL_QUERY_PARAM,
  ORCHESTRATION_PROTOCOL_VERSION,
} from "@e6tools/contracts";
import type { BrowserContext, Cookie, Page } from "playwright-core";

import {
  captureWsFrames,
  idleCheck,
  newMeasuredContext,
  pingProbe,
  readPageTimings,
  sleep,
  traced,
  waitForMark,
  type PageTimings,
} from "../browser.ts";
import { observedScriptBytes } from "../bundle.ts";
import type { MetricOutcome } from "../report.ts";
import {
  addedRoundTripMs,
  pingAddedMs,
  pingRoundTrips,
  THROTTLE_VISIBLE_MS,
  unaryRoundTrips,
  type WsFrame,
} from "../wsFrames.ts";
import { percentile } from "../stats.ts";
import { harnessStop } from "../stopLatch.ts";
import { runProxySelfTest, startThrottleProxy } from "../throttleProxy.ts";
import {
  bootScriptEvaluationMs,
  longTaskDurations,
  userTimingTs,
  type TraceEvent,
} from "../traceFrames.ts";
import { LandingError, landedOnAuth } from "./landing.ts";
import {
  idlePoint,
  screenshotIfStill,
  type ScenarioContext,
  type ScenarioResult,
} from "./scenario.ts";

const LOCAL_LOADS = 5;
const REMOTE_COLD_LOADS = 3;
const REMOTE_WARM_LOADS = 3;
export const REMOTE_PROFILE = { rttMs: 60, mbps: 20 } as const;
const LANDING_PREFIX = "e6:startup:landing:";
const INTERACTIVE_PREFIX = "e6:startup:shell-interactive:";
const AFTER_INTERACTIVE_MS = 2_000;
// Remote loads stay open past interactive so unary RPCs sent once the bundle has arrived,
// with the link no longer busy, are captured for addedRpcRoundTripMs.
const REMOTE_HOLD_MS = 2_000;
const WARM_HOLD_MS = 1_000;
// RPC pings the harness sends from the idle page, each way, for addedRpcRoundTripMs.
const PING_SAMPLES = 7;
const PING_QUERY = { [ORCHESTRATION_PROTOCOL_QUERY_PARAM]: String(ORCHESTRATION_PROTOCOL_VERSION) };

/**
 * Navigates (or reloads) and waits until the shell is interactive. Landing
 * anywhere but the app (an empty home's welcome, a failed pairing) throws a
 * `LandingError`.
 */
export async function loadUntilInteractive(
  page: Page,
  navigate: () => Promise<unknown>,
  holdMs: number,
): Promise<{
  readonly landing: string;
  readonly interactive: { name: string; startTime: number };
}> {
  await navigate();
  const hit = await waitForMark(page, LANDING_PREFIX, 60_000);
  const landing = hit === null ? "none" : hit.name.slice(LANDING_PREFIX.length);
  if (landing !== "app") throw new LandingError(landing);
  const interactive = await waitForMark(page, INTERACTIVE_PREFIX, 60_000);
  if (interactive === null) throw new Error("the shell never became interactive");
  if (holdMs > 0) await sleep(holdMs);
  return { landing, interactive };
}

interface LoadSample {
  readonly interactiveMs: number;
  readonly interactiveMark: string;
  readonly timings: PageTimings;
  readonly frames: ReadonlyArray<WsFrame>;
  readonly events: ReadonlyArray<TraceEvent>;
}

async function coldLoad(
  ctx: ScenarioContext,
  input: {
    readonly origin: string;
    readonly cookies: ReadonlyArray<Cookie>;
    readonly traceName: string | null;
  },
): Promise<{
  readonly sample: LoadSample;
  readonly context: BrowserContext;
  readonly page: Page;
  /** Every frame the page's sockets carried so far, still growing while the page is open. */
  readonly liveFrames: ReadonlyArray<WsFrame>;
}> {
  const context = await newMeasuredContext(ctx.browser, {
    cookies: input.cookies,
    motion: ctx.motion,
  });
  try {
    const page = await context.newPage();
    const ws = await captureWsFrames(page);
    const navigate = () => page.goto(`${input.origin}/`, { waitUntil: "commit" });
    const measured =
      input.traceName === null
        ? { result: await loadUntilInteractive(page, navigate, REMOTE_HOLD_MS), events: [] }
        : await traced(ctx.browser, page, { name: input.traceName, keepDir: ctx.traceDir }, () =>
            loadUntilInteractive(page, navigate, AFTER_INTERACTIVE_MS),
          );
    const timings = await readPageTimings(page);
    return {
      context,
      page,
      liveFrames: ws.frames,
      sample: {
        interactiveMs: measured.result.interactive.startTime,
        interactiveMark: measured.result.interactive.name,
        timings,
        frames: [...ws.frames],
        events: measured.events,
      },
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}

const p95 = (values: ReadonlyArray<number>) => percentile(values, 0.95) ?? Number.NaN;

/** The ping probe's round trips, or none (with a note) when it fails: the loads still count. */
const probePings = (page: Page, where: string, notes: Array<string>) =>
  pingProbe(page, { count: PING_SAMPLES, query: PING_QUERY }).catch((error: unknown) => {
    notes.push(
      `ping probe ${where} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  });

const points = (prefix: string, values: ReadonlyArray<number>) =>
  values.map((value, index) => ({ label: `${prefix}.${index + 1}`, atMs: null, value }));

export async function runColdLoad(ctx: ScenarioContext): Promise<ScenarioResult> {
  const notes: Array<string> = [];
  const local: Array<LoadSample> = [];
  let idle: Awaited<ReturnType<typeof idleCheck>> | null = null;
  let directPings: Array<number> = [];
  // The client's own 5 s pings seen during the loads, kept in raw beside the probe's.
  let directClientPings: Array<number> = [];
  const screenshots: Array<{ point: string; path: string }> = [];

  for (let load = 1; load <= LOCAL_LOADS; load += 1) {
    ctx.log(`cold load ${load}/${LOCAL_LOADS} (local)`);
    const { sample, context, page, liveFrames } = await coldLoad(ctx, {
      origin: ctx.origin,
      cookies: ctx.cookies,
      traceName: `coldLoad.local.${load}`,
    });
    local.push(sample);
    try {
      if (load === LOCAL_LOADS) {
        idle = await idleCheck(ctx.browser, page, {
          name: "coldLoad.shellInteractive.idle",
          keepDir: ctx.traceDir,
        });
        directClientPings = pingRoundTrips(liveFrames);
        directPings = await probePings(page, "direct", notes);
        const shot = await screenshotIfStill(ctx, page, "coldLoad.shellInteractive", idle);
        if ("taken" in shot) screenshots.push(shot.taken);
        else if (shot.skipped !== null) notes.push(shot.skipped);
      }
    } finally {
      await context.close();
    }
  }

  ctx.log("proxy self-test");
  harnessStop.check("the proxy self-test");
  const selfTest = await runProxySelfTest({ mode: "shaped", ...REMOTE_PROFILE });
  const proxy = await harnessStop.start(
    "the throttle proxy",
    () =>
      startThrottleProxy({
        targetHost: "127.0.0.1",
        targetPort: ctx.serverPort,
        mode: "shaped",
        ...REMOTE_PROFILE,
      }),
    (started) => started.close(),
  );
  const remoteOrigin = `http://127.0.0.1:${proxy.port}`;
  const remoteCold: Array<LoadSample> = [];
  const remoteWarm: Array<{ interactiveMs: number; interactiveMark: string }> = [];
  const warmFrames: Array<WsFrame> = [];
  let remotePings: Array<number> = [];
  let remoteClientPings: Array<number> = [];
  let remoteCookies: ReadonlyArray<Cookie> = ctx.cookies;
  let pairedThroughProxy = false;
  try {
    for (let load = 1; load <= REMOTE_COLD_LOADS; load += 1) {
      ctx.log(`cold load ${load}/${REMOTE_COLD_LOADS} (remote)`);
      let attempt: Awaited<ReturnType<typeof coldLoad>>;
      try {
        attempt = await coldLoad(ctx, {
          origin: remoteOrigin,
          cookies: remoteCookies,
          traceName: null,
        });
      } catch (error) {
        // The plan's fallback (§4.1, check 7.4) when the cookie does not carry to the proxy port;
        // any other failure is the sample's own and fails the scenario.
        if (load !== 1 || pairedThroughProxy || !landedOnAuth(error)) throw error;
        notes.push(
          `cookie did not carry through the proxy (the load landed on '${error.landing}'); paired through it`,
        );
        remoteCookies = await ctx.pairAt(remoteOrigin);
        pairedThroughProxy = true;
        attempt = await coldLoad(ctx, {
          origin: remoteOrigin,
          cookies: remoteCookies,
          traceName: null,
        });
      }
      remoteCold.push(attempt.sample);
      if (load < REMOTE_COLD_LOADS) {
        await attempt.context.close();
        continue;
      }
      try {
        for (let warm = 1; warm <= REMOTE_WARM_LOADS; warm += 1) {
          ctx.log(`warm load ${warm}/${REMOTE_WARM_LOADS} (remote)`);
          const { interactive } = await loadUntilInteractive(
            attempt.page,
            () => attempt.page.reload({ waitUntil: "commit" }),
            WARM_HOLD_MS,
          );
          remoteWarm.push({
            interactiveMs: interactive.startTime,
            interactiveMark: interactive.name,
          });
        }
        // Read before the probe, whose own socket the page's frame capture also sees.
        warmFrames.push(...attempt.liveFrames.slice(attempt.sample.frames.length));
        remoteClientPings = pingRoundTrips(warmFrames);
        remotePings = await probePings(attempt.page, "through the proxy", notes);
      } finally {
        await attempt.context.close();
      }
    }
  } finally {
    await proxy.close();
  }
  if (!pairedThroughProxy) {
    notes.push("cookies-only contexts reached landing:app directly and through the proxy");
  }
  notes.push("the TCP proxy delays bytes after connect; the TCP handshake itself is not delayed");

  const fcp = local.map((sample) => sample.timings.paints["first-contentful-paint"] ?? Number.NaN);
  const fp = local.map((sample) => sample.timings.paints["first-paint"] ?? Number.NaN);
  const bootScript = local.map((sample) => {
    const landingTs = userTimingTs(sample.events, "e6:startup:landing:app");
    return bootScriptEvaluationMs(sample.events, {
      untilTs: landingTs ?? Number.POSITIVE_INFINITY,
    });
  });
  const landingInTrace = local.every(
    (sample) => userTimingTs(sample.events, "e6:startup:landing:app") !== null,
  );
  const bundle = await observedScriptBytes(local[0]?.timings.scripts ?? [], ctx.distDir);
  notes.push(
    `motion: client settings after boot hold motion=${local[0]?.timings.storedMotion ?? "nothing"}`,
  );
  const directTrips = local.flatMap((sample) => unaryRoundTrips(sample.frames));
  const remoteTrips = [
    ...remoteCold.flatMap((sample) => unaryRoundTrips(sample.frames)),
    ...unaryRoundTrips(warmFrames),
  ];
  const unaryAdded = addedRoundTripMs(directTrips, remoteTrips);
  const pinged = pingAddedMs({ direct: directPings, remote: remotePings });
  const addedMs = pinged?.addedMs ?? unaryAdded?.addedMs ?? null;
  notes.push(
    pinged !== null
      ? `addedRpcRoundTripMs from the median of ${remotePings.length} RPC pings through the proxy (${pinged.remoteMedianMs.toFixed(1)} ms) minus the median of ${directPings.length} direct (${pinged.directMedianMs.toFixed(1)} ms), each sent from the idle page`
      : "addedRpcRoundTripMs from unary RPC round trips (no ping probe answered); they include server time",
  );
  if (addedMs !== null && addedMs < THROTTLE_VISIBLE_MS) {
    notes.push(
      `addedRpcRoundTripMs: ${addedMs.toFixed(1)} ms is under ${THROTTLE_VISIBLE_MS} ms; the ${REMOTE_PROFILE.rttMs} ms throttle did not visibly apply to RPC round trips`,
    );
  }

  const metrics: Array<MetricOutcome> = [
    {
      kind: "measured",
      id: "web.firstPaint.local",
      unit: "ms",
      statistic: "p95",
      value: p95(fcp),
      samples: fcp.length,
      source: "paint-timing:first-contentful-paint",
      points: points("local", fcp),
    },
    {
      kind: "measured",
      id: "web.interactive.remote.cold",
      unit: "ms",
      statistic: "p95",
      value: p95(remoteCold.map((sample) => sample.interactiveMs)),
      samples: remoteCold.length,
      source: "mark:e6:startup:shell-interactive via tcp-proxy",
      points: points(
        "remoteCold",
        remoteCold.map((sample) => sample.interactiveMs),
      ),
    },
    {
      kind: "measured",
      id: "web.interactive.remote.warm",
      unit: "ms",
      statistic: "p95",
      value: p95(remoteWarm.map((sample) => sample.interactiveMs)),
      samples: remoteWarm.length,
      source: "mark:e6:startup:shell-interactive via tcp-proxy, reload in the same context",
      points: points(
        "remoteWarm",
        remoteWarm.map((sample) => sample.interactiveMs),
      ),
    },
    bundle.files.length === 0
      ? {
          kind: "notMeasured",
          id: "bundle.entryPlusChat.brotliBytes",
          reason: "no built scripts matched the scripts the cold load fetched",
        }
      : {
          kind: "measured",
          id: "bundle.entryPlusChat.brotliBytes",
          unit: "bytes",
          statistic: "value",
          value: bundle.brotliBytes,
          samples: null,
          source: "resource-timing:/assets/*.js of the first cold load, brotli quality 11",
        },
    {
      kind: "measured",
      id: "bundle.bootScriptEvaluationMs",
      unit: "ms",
      statistic: "p95",
      value: p95(bootScript),
      samples: bootScript.length,
      source: "cdp-trace:EvaluateScript+v8.compile/evaluate until e6:startup:landing:app",
      ...(landingInTrace ? {} : { flags: ["untilTraceEnd"] }),
      points: points("local", bootScript),
    },
  ];

  return {
    metrics,
    idlePoints: idle === null ? [] : [idlePoint("coldLoad.shellInteractive", idle)],
    screenshots,
    raw: {
      local: local.map((sample, index) => ({
        firstPaintMs: fp[index],
        firstContentfulPaintMs: fcp[index],
        interactiveMs: sample.interactiveMs,
        interactiveMark: sample.interactiveMark,
        landingMs:
          sample.timings.marks.find((mark) => mark.name.startsWith(LANDING_PREFIX))?.startTime ??
          null,
        shellLiveMs:
          sample.timings.marks.find((mark) => mark.name === "e6:startup:shell-live")?.startTime ??
          null,
        bootScriptMs: bootScript[index],
        longTasksMs: longTaskDurations(sample.events),
        scripts: sample.timings.scripts.length,
        resourceEntries: sample.timings.resourceEntries,
      })),
      remoteCold: remoteCold.map((sample) => ({
        interactiveMs: sample.interactiveMs,
        interactiveMark: sample.interactiveMark,
      })),
      remoteWarm,
      bundle: {
        brotliBytes: bundle.brotliBytes,
        rawBytes: bundle.rawBytes,
        files: bundle.files,
        unmatched: bundle.unmatched,
      },
      proxy: {
        profile: REMOTE_PROFILE,
        selfTest,
        pairedThroughProxy,
        bytes: proxy.counters.totals(),
        connections: proxy.counters.connections().length,
      },
      rpc: {
        directUnary: directTrips.length,
        remoteUnary: remoteTrips.length,
        unaryAdded,
        pingProbe: { samplesEachWay: PING_SAMPLES, added: pinged },
        directPingsMs: directPings,
        remotePingsMs: remotePings,
        directClientPingsMs: directClientPings,
        remoteClientPingsMs: remoteClientPings,
      },
      idle,
    },
    validity: {
      motionResolved: local[0]?.timings.motion ?? null,
      proxySelfTest: selfTest,
      addedRpcRoundTripMs: addedMs,
      notes,
    },
  };
}
