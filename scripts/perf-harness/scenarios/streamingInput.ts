// @effect-diagnostics nodeBuiltinImport:off globalDate:off - checks the provider event log on disk and times the window on the wall clock the server's intervals use.
/**
 * Typing while a turn streams (plan §4.3). The browser reaches the server
 * through a passthrough proxy, only so wire bytes can be counted. It opens a
 * seeded cursor thread, whose replay plays `cursor.streaming-prose` at a
 * steady 50 events/s, and presses Enter once: that starts turn 1 and is the
 * only submit. While a turn runs, the page types plain letters and spaces at
 * 10 keys/s into the composer and never Enter, `/` or `@` (a message during a
 * running turn would fail its turn start). Turns 2 and 3 are dispatched by
 * the control client once the previous turn has visibly ended.
 *
 * The window runs from turn 1 visibly running (the Stop button and a live
 * event on the thread's subscription) to turn 3 ending. Inside it: keydown
 * Event Timing entries (only those of 16 ms or more are reported), long
 * tasks, WebSocket frames, proxy bytes on the `/ws` connection, the server's
 * event-loop intervals that lie wholly inside it, and command acknowledgement
 * from the OTLP exports either side of it. The replay's achieved rate comes
 * from the trace file once the server has stopped.
 *
 * @module perf-harness/scenarios/streamingInput
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import type { Page } from "playwright-core";

import {
  captureWsFrames,
  idleCheck,
  newMeasuredContext,
  readPageTimings,
  waitForMark,
  type PageGlobal,
} from "../browser.ts";
import { turnStartCommand } from "../controlClient.ts";
import { ackWindow, COMMAND_ACK_METRIC } from "../otlpSink.ts";
import type { MetricOutcome } from "../report.ts";
import { readServerTrace } from "../serverProcess.ts";
import {
  eventLoopInWindow,
  playSegmentRates,
  snapshotEventLoopIntervals,
  type WallWindow,
} from "../serverSignals.ts";
import { p95WithUnreported, summarize } from "../stats.ts";
import { startThrottleProxy, type ByteCounters } from "../throttleProxy.ts";
import { classifyWsFrames, liveTraffic, threadEvents, type WsFrame } from "../wsFrames.ts";
import { loadUntilInteractive } from "./coldLoad.ts";
import {
  idlePoint,
  screenshotIfStill,
  type ScenarioContext,
  type ScenarioResult,
} from "./scenario.ts";
import { sidebarRowKeys, switchTo, threadIdOf } from "./threadSwitch.ts";

export const STREAM_RECORDING = "cursor.streaming-prose";
export const STREAM_EVENTS_PER_SECOND = 50;
const TURNS = 3;
const KEY_INTERVAL_MS = 100;
// Keys typed between checks of whether the turn still runs: half a second at 10 keys/s.
const KEYS_PER_CHECK = 5;
const TYPED_TEXT = "the quick brown fox jumps over the lazy dog ";
const COMPOSER = '[data-testid="composer-editor"]';
const STOP_BUTTON = 'button[aria-label="Stop generation"]';
const TURN_START_TIMEOUT_MS = 30_000;
const TURN_TIMEOUT_MS = 120_000;
const EVENT_TIMING_THRESHOLD_MS = 16;
const OTLP_WAIT_MS = 10_000;

const stopVisible = (page: Page) =>
  page.evaluate(
    (selector) =>
      (globalThis as unknown as PageGlobal).document.querySelectorAll(selector).length > 0,
    STOP_BUTTON,
  );

/** A received frame carrying a live orchestration event for `threadId`. */
const isThreadEventFrame = (threadId: string) => (frame: WsFrame) =>
  frame.direction === "received" &&
  frame.payload.includes('"kind":"event"') &&
  frame.payload.includes(`"threadId":"${threadId}"`);

/** Server-to-client bytes on the proxy's WebSocket connections. */
const wsBytes = (counters: ByteCounters) =>
  counters
    .connections()
    .filter((connection) => connection.target === "GET /ws")
    .reduce((sum, connection) => sum + connection.serverToClient, 0);

interface TurnRecord {
  readonly turn: number;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly keysTyped: number;
  readonly stopAppearedAtFrame: number;
  readonly stopGoneAtFrame: number;
  readonly shellAfterEnd: { readonly latestTurn: string | null; readonly session: string | null };
}

export async function runStreamingInput(ctx: ScenarioContext): Promise<ScenarioResult> {
  const notes: Array<string> = [];
  const control = await ctx.control();
  const shell = await control.shellSnapshot();
  const streamThread = shell.threads.find(
    (thread) =>
      thread.id !== ctx.seed.longThreadId &&
      thread.id.startsWith("perf-seed-thread-") &&
      thread.modelSelection.instanceId === "cursor",
  );
  if (streamThread === undefined) throw new Error("no seeded short cursor thread to stream on");
  const threadId = streamThread.id;

  const proxy = await startThrottleProxy({
    targetHost: "127.0.0.1",
    targetPort: ctx.serverPort,
    mode: "passthrough",
    rttMs: 0,
    mbps: 1_000,
  });
  const context = await newMeasuredContext(ctx.browser, {
    cookies: ctx.cookies,
    motion: ctx.motion,
  });
  try {
    const page = await context.newPage();
    const ws = await captureWsFrames(page);
    await loadUntilInteractive(
      page,
      () => page.goto(`http://127.0.0.1:${proxy.port}/`, { waitUntil: "commit" }),
      0,
    );
    await waitForMark(page, "e6:startup:shell-live", 30_000);
    const key = (await sidebarRowKeys(page)).find((entry) => threadIdOf(entry) === threadId);
    if (key === undefined) throw new Error(`the sidebar did not render thread ${threadId}`);
    const opened = await switchTo(page, key, "first");
    if (opened.liveMs === null) throw new Error(`thread ${threadId} never went live`);

    await page.click(COMPOSER);
    await page.keyboard.type("Tell me about streaming", { delay: 20 });
    const beforeSubmit = ws.frames.length;
    await page.keyboard.press("Enter");
    await page.waitForSelector(STOP_BUTTON, { state: "attached", timeout: TURN_START_TIMEOUT_MS });
    const firstEvent = await ws.waitForFrame(
      beforeSubmit,
      isThreadEventFrame(threadId),
      TURN_START_TIMEOUT_MS,
    );
    if (firstEvent === null) throw new Error("turn 1 showed Stop but no live event arrived");

    const window = {
      startFrame: ws.frames.length,
      startWallMs: Date.now(),
      startPageMs: await page.evaluate(() => performance.now()),
      startWsBytes: wsBytes(proxy.counters),
      endFrame: 0,
      endWallMs: 0,
      endPageMs: 0,
      endWsBytes: 0,
    };
    const turns: Array<TurnRecord> = [];
    let typed = 0;
    let letter = 0;
    let stopAppearedAtFrame = beforeSubmit;
    for (let turn = 1; turn <= TURNS; turn += 1) {
      const startedAtMs = Date.now();
      if (turn > 1) {
        const before = ws.frames.length;
        const dispatched = await control.dispatch(
          turnStartCommand({
            id: `stream-${startedAtMs}-${turn}`,
            threadId,
            text: `Continue with part ${turn}.`,
            atMs: startedAtMs,
          }),
        );
        if (!dispatched.ok) {
          throw new Error(
            `turn ${turn} dispatch failed with ${dispatched.status}: ${dispatched.body}`,
          );
        }
        await page.waitForSelector(STOP_BUTTON, {
          state: "attached",
          timeout: TURN_START_TIMEOUT_MS,
        });
        stopAppearedAtFrame = before;
        const live = await ws.waitForFrame(
          before,
          isThreadEventFrame(threadId),
          TURN_START_TIMEOUT_MS,
        );
        if (live === null) throw new Error(`turn ${turn} showed Stop but no live event arrived`);
      }
      ctx.log(`turn ${turn}/${TURNS} streaming; typing`);
      let keysTyped = 0;
      while (await stopVisible(page)) {
        if (Date.now() - startedAtMs > TURN_TIMEOUT_MS) {
          throw new Error(`turn ${turn} still ran after ${TURN_TIMEOUT_MS} ms`);
        }
        const focused = await page.evaluate(
          (selector) =>
            (
              globalThis as unknown as {
                readonly document: {
                  readonly activeElement: { closest(selector: string): unknown } | null;
                };
              }
            ).document.activeElement?.closest(selector) != null,
          COMPOSER,
        );
        if (!focused) await page.focus(COMPOSER);
        let chunk = "";
        for (let index = 0; index < KEYS_PER_CHECK; index += 1) {
          chunk += TYPED_TEXT[letter % TYPED_TEXT.length];
          letter += 1;
        }
        await page.keyboard.type(chunk, { delay: KEY_INTERVAL_MS });
        keysTyped += chunk.length;
      }
      typed += keysTyped;
      const endedAtMs = Date.now();
      const after = await control.shellSnapshot();
      const shown = after.threads.find((thread) => thread.id === threadId);
      turns.push({
        turn,
        startedAtMs,
        endedAtMs,
        keysTyped,
        stopAppearedAtFrame,
        stopGoneAtFrame: ws.frames.length,
        shellAfterEnd: {
          latestTurn: shown?.latestTurn?.state ?? null,
          session: shown?.session?.status ?? null,
        },
      });
    }
    window.endFrame = ws.frames.length;
    window.endWallMs = Date.now();
    window.endPageMs = await page.evaluate(() => performance.now());
    window.endWsBytes = wsBytes(proxy.counters);
    const wall: WallWindow = { startMs: window.startWallMs, endMs: window.endWallMs };
    const windowSeconds = (window.endWallMs - window.startWallMs) / 1000;
    ctx.log(`stream window ${windowSeconds.toFixed(1)} s, ${typed} keys typed`);

    const timings = await readPageTimings(page);
    const inPageWindow = (start: number) =>
      start >= window.startPageMs && start <= window.endPageMs;
    const keydowns = timings.events
      .filter((entry) => entry.name === "keydown" && inPageWindow(entry.start))
      .map((entry) => entry.duration);
    const keystroke = p95WithUnreported({
      reported: keydowns,
      total: typed,
      thresholdMs: EVENT_TIMING_THRESHOLD_MS,
    });
    const longTasks = timings.longTasks
      .filter((entry) => inPageWindow(entry.start))
      .map((entry) => entry.duration);
    const longAnimationFrames = timings.longAnimationFrames.filter((entry) =>
      inPageWindow(entry.start),
    );

    const classified = classifyWsFrames(ws.frames);
    const inWindow = classified.slice(window.startFrame, window.endFrame);
    const traffic = liveTraffic(inWindow);
    const threadFrames = traffic.byMethod["orchestration.subscribeThread"];
    // The Stop button is the turn-running signal only if the session ran while it showed and had
    // stopped running by the time it left: the session statuses the thread's subscription carried
    // between those two moments, and the shell read right after, say whether it held.
    const sessionEvidence = turns.map((turn) => ({
      turn: turn.turn,
      sessionStatuses: threadEvents(
        classified.slice(turn.stopAppearedAtFrame, turn.stopGoneAtFrame),
      )
        .map((entry) => entry.sessionStatus)
        .filter((status): status is string => status !== null),
      shellAfterEnd: turn.shellAfterEnd,
    }));
    const stopSignalHeld = sessionEvidence.every(
      (entry) =>
        entry.sessionStatuses.includes("running") &&
        entry.sessionStatuses.at(-1) !== "running" &&
        entry.shellAfterEnd.session !== "running" &&
        entry.shellAfterEnd.latestTurn !== "running",
    );
    notes.push(
      stopSignalHeld
        ? "streamingInput: the Stop button left as each turn's session stopped running (thread events and the shell agree)"
        : `streamingInput: the Stop button and the session disagreed: ${JSON.stringify(sessionEvidence)}`,
    );

    const ackAfter =
      ctx.otlp === null ? null : await ctx.otlp.exportAtOrAfter(window.endWallMs, OTLP_WAIT_MS);
    const ackBefore = ctx.otlp?.exportAtOrBefore(window.startWallMs) ?? null;
    const ack =
      ackAfter === null ? null : ackWindow({ before: ackBefore?.ack ?? [], after: ackAfter.ack });

    const rpc = await control.openRpc();
    const performanceMetrics = await rpc.getPerformanceMetrics().finally(() => rpc.close());
    const eventLoop = performanceMetrics.eventLoop;
    const intervals = Option.isSome(eventLoop)
      ? eventLoop.value.intervals.map((interval) => ({
          endedAtMs: DateTime.toEpochMillis(interval.endedAt),
          p99Ms: interval.p99Ms,
          maxMs: interval.maxMs,
          utilization: interval.utilization,
        }))
      : [];
    const loop = eventLoopInWindow(intervals, wall, performanceMetrics.intervalMs);
    const resolutionMs = Option.isSome(eventLoop) ? eventLoop.value.resolutionMs : null;

    const idle = await idleCheck(ctx.browser, page, {
      name: "streamingInput.turnSettled.idle",
      keepDir: ctx.traceDir,
    });
    const screenshots: Array<{ point: string; path: string }> = [];
    const shot = await screenshotIfStill(ctx, page, "streamingInput.turnSettled", idle);
    if ("taken" in shot) screenshots.push(shot.taken);
    else if (shot.skipped !== null) notes.push(shot.skipped);

    const fastestClamped = timings.clampProbe.length === 0 ? null : Math.min(...timings.clampProbe);
    const metrics: Array<MetricOutcome> = [
      keystroke === null
        ? { kind: "notMeasured", id: "web.input.keystrokeToPaint.p95", reason: "no keys typed" }
        : {
            kind: "measured",
            id: "web.input.keystrokeToPaint.p95",
            unit: "ms",
            statistic: keystroke.atMost ? "p95AtMost" : "p95",
            value: keystroke.value,
            samples: keystroke.samples,
            source:
              "event-timing:keydown duration over keys typed while a turn streamed; unreported keys count as under the threshold",
            flags: [
              `eventTimingThreshold:${EVENT_TIMING_THRESHOLD_MS}ms`,
              `keydownsReported:${keydowns.length}`,
            ],
          },
      {
        kind: "measured",
        id: "web.input.longTaskMax.streaming",
        unit: "ms",
        statistic: "max",
        value: longTasks.length === 0 ? 0 : Math.max(...longTasks),
        samples: longTasks.length,
        source: "longtask observer over the stream window",
        flags: longTasks.length === 0 ? ["noLongTasks"] : [],
      },
      loop.maxP99Ms === null
        ? {
            kind: "notMeasured",
            id: "server.eventLoop.p99.streaming",
            reason: `no 10 s server interval lay wholly inside the ${windowSeconds.toFixed(1)} s stream window`,
          }
        : {
            kind: "measured",
            id: "server.eventLoop.p99.streaming",
            unit: "ms",
            statistic: "max",
            value: loop.maxP99Ms,
            samples: loop.intervals.length,
            source:
              "rpc:server.getPerformanceMetrics eventLoop.intervals[].p99Ms, worst interval wholly inside the stream window",
            flags: resolutionMs === null ? [] : [`resolutionSubtracted:${resolutionMs}ms`],
            points: loop.intervals.map((interval, index) => ({
              label: `interval.${index + 1}`,
              atMs: interval.endedAtMs - window.startWallMs,
              value: interval.p99Ms,
            })),
          },
      ctx.otlp === null
        ? {
            kind: "notMeasured",
            id: "server.commandAck.p95",
            reason: "--no-otlp: the server exported no metrics",
          }
        : ack === null
          ? {
              kind: "notMeasured",
              id: "server.commandAck.p95",
              reason: `no OTLP export arrived within ${OTLP_WAIT_MS} ms after the window`,
            }
          : ack.p95AtMost === null
            ? {
                kind: "notMeasured",
                id: "server.commandAck.p95",
                reason:
                  ack.samples === 0
                    ? "no command was acknowledged inside the window"
                    : `the p95 fell in the overflow bucket (${ack.bucket})`,
              }
            : {
                kind: "measured",
                id: "server.commandAck.p95",
                unit: "ms",
                statistic: "p95AtMost",
                value: ack.p95AtMost,
                samples: ack.samples,
                source: `otlp:${COMMAND_ACK_METRIC} bucket delta between the exports either side of the stream window`,
                flags: [
                  `bucketResolution:${ack.bucket}ms`,
                  `windowEdgeSlackMs:${Math.round(window.startWallMs - (ackBefore?.timeUnixMs ?? window.startWallMs))}+${Math.round((ackAfter?.timeUnixMs ?? window.endWallMs) - window.endWallMs)}`,
                ],
              },
      traffic.liveFrameMaxBytes === null
        ? {
            kind: "notMeasured",
            id: "ws.liveFrame.maxBytes",
            reason: "no live frame in the window",
          }
        : {
            kind: "measured",
            id: "ws.liveFrame.maxBytes",
            unit: "bytes",
            statistic: "max",
            value: traffic.liveFrameMaxBytes,
            samples: traffic.liveFrames,
            source:
              "cdp:Network.webSocketFrameReceived live chunks (after each subscription's snapshot or marker), decompressed",
          },
      traffic.liveEventP95Bytes === null
        ? {
            kind: "notMeasured",
            id: "ws.liveEvent.p95Bytes",
            reason: "no live event in the window",
          }
        : {
            kind: "measured",
            id: "ws.liveEvent.p95Bytes",
            unit: "bytes",
            statistic: "p95",
            value: traffic.liveEventP95Bytes,
            samples: traffic.liveEvents,
            source: "cdp:Network.webSocketFrameReceived, JSON bytes of each live chunk value",
          },
      {
        kind: "measured",
        id: "ws.streaming.wireBytesPerSecond",
        unit: "bytesPerSecond",
        statistic: "value",
        value: (window.endWsBytes - window.startWsBytes) / windowSeconds,
        samples: null,
        source:
          "tcp-proxy passthrough: server-to-client bytes on the /ws connection over the stream window",
      },
    ];

    return {
      metrics,
      idlePoints: [idlePoint("streamingInput.turnSettled", idle)],
      screenshots,
      raw: {
        threadId,
        windowMs: window.endWallMs - window.startWallMs,
        keysTyped: typed,
        turns,
        sessionEvidence,
        keydown: {
          reportedOverThreshold: keydowns.length,
          reportedMs: summarize(keydowns),
          shortestWithZeroThreshold: fastestClamped,
        },
        longTasksMs: longTasks,
        longAnimationFrames: {
          count: longAnimationFrames.length,
          durationMs: summarize(longAnimationFrames.map((entry) => entry.duration)),
          blockingMs: summarize(longAnimationFrames.map((entry) => entry.blockingDuration)),
        },
        ws: {
          framesInWindow: inWindow.length,
          receivedBytes: traffic.receivedBytes,
          decompressedBytesPerSecond: traffic.receivedBytes / windowSeconds,
          liveFrames: traffic.liveFrames,
          liveEvents: traffic.liveEvents,
          liveEventMaxBytes: traffic.liveEventMaxBytes,
          threadLiveFramesPerSecond: (threadFrames?.liveFrames ?? 0) / windowSeconds,
          threadLiveEventsPerSecond:
            threadEvents(
              inWindow.filter((frame) => frame.method === "orchestration.subscribeThread"),
            ).length / windowSeconds,
          byMethod: traffic.byMethod,
        },
        wire: {
          wsServerToClientBytes: window.endWsBytes - window.startWsBytes,
          compressionRatio:
            window.endWsBytes > window.startWsBytes
              ? traffic.receivedBytes / (window.endWsBytes - window.startWsBytes)
              : null,
          connections: proxy.counters.connections(),
        },
        eventLoop: {
          resolutionMs,
          intervalMs: performanceMetrics.intervalMs,
          inWindow: loop.intervals,
          all: intervals.map((interval) => ({
            ...interval,
            insideWindow: loop.intervals.includes(interval),
          })),
        },
        commandAck:
          ack === null
            ? null
            : {
                ...ack,
                exportsSeen: ctx.otlp?.exports.length ?? 0,
                beforeAtMs: ackBefore?.timeUnixMs ?? null,
                afterAtMs: ackAfter?.timeUnixMs ?? null,
              },
        rpcTotals: performanceMetrics.rpcTotals,
        idle,
      },
      validity: {
        eventTimingObserved: timings.firstInput.length > 0,
        notes,
      },
      afterStop: async ({ home, forced }) => {
        const trace = await readServerTrace(home);
        const rates = playSegmentRates(trace.records, wall);
        const streamRate = rates[STREAM_RECORDING];
        const snapshots = eventLoopInWindow(
          snapshotEventLoopIntervals(trace.records).map((interval) => ({
            ...interval,
            p99Ms: interval.rawP99Ms,
          })),
          wall,
          performanceMetrics.intervalMs,
        );
        const providerLog = NodePath.join(home, `userdata/logs/provider/events.${threadId}.log`);
        const providerLogLines = await NodeFSP.readFile(providerLog, "utf8").then(
          (text) => text.split("\n").filter((line) => line.trim().length > 0).length,
          () => null,
        );
        const afterNotes = [
          streamRate === undefined
            ? `streamingInput: no ${STREAM_RECORDING} playSegment span in the trace file${forced ? " (the server was killed before it flushed)" : ""}`
            : `streamingInput: replay achieved ${streamRate.eventsPerSecond.toFixed(1)} events/s over ${streamRate.segments} segments (target ${STREAM_EVENTS_PER_SECOND}); the client saw ${((threadFrames?.liveFrames ?? 0) / windowSeconds).toFixed(1)} live thread frames/s`,
          providerLogLines === null
            ? "streamingInput: no provider event log for the stream thread"
            : `streamingInput: the provider event log is on by default, one file per thread; it holds ${providerLogLines} records for the stream thread against ${streamRate?.events ?? "an unknown number of"} events played`,
        ];
        const loopMetric = metrics.find((metric) => metric.id === "server.eventLoop.p99.streaming");
        return {
          raw: {
            providerRate: { byRecording: rates, target: STREAM_EVENTS_PER_SECOND },
            rawEventLoop: snapshots,
            trace: { files: trace.files, bytes: trace.bytes, records: trace.records.length },
            providerEventLogLines: providerLogLines,
          },
          notes: afterNotes,
          metrics:
            loopMetric?.kind === "measured" && snapshots.maxP99Ms !== null
              ? [
                  {
                    ...loopMetric,
                    flags: [...(loopMetric.flags ?? []), `rawP99Ms:${snapshots.maxP99Ms}`],
                  },
                ]
              : [],
        };
      },
    };
  } finally {
    await context.close();
    await proxy.close();
  }
}
