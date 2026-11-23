// @effect-diagnostics globalTimers:off globalDate:off - paces the soak on the wall clock and retries rejected dispatches.
/**
 * The accelerated soak (plan §4.5). All four recordings replay at
 * `--soak-factor` times their recorded timing (gaps capped at 2 s, gates
 * answered automatically, looping when exhausted). One seeded thread per
 * replayed kind is kept busy by the control client: it follows
 * `subscribeShell` and starts the next turn as soon as a thread's turn ends,
 * so the load is event-driven. Meanwhile the page clicks through the seeded
 * threads in the sidebar to churn subscriptions, from the start and every
 * `ctx.soak.cycleIntervalMs` (at most 10 s, short enough to reach every
 * seeded thread), and every 30 s the harness forces a renderer GC and samples
 * its heap, and the server's RSS by PID. Nothing is traced. The extra shell subscriber is real server work the
 * report names.
 *
 * Acceleration speeds up the provider stream, not timers, TTLs or clocks, so
 * the duration is a replay-time equivalent.
 *
 * @module perf-harness/scenarios/soak
 */
import type { OrchestrationThreadShell } from "@e6tools/contracts";

import { heapAfterGc, newMeasuredContext, sleep, waitForMark } from "../browser.ts";
import { turnStartCommand } from "../controlClient.ts";
import type { MetricOutcome } from "../report.ts";
import { readServerTrace } from "../serverProcess.ts";
import { playSegmentRates } from "../serverSignals.ts";
import { SoakTurnScheduler, type ShellThreadView } from "../soakScheduler.ts";
import { growthSlope } from "../stats.ts";
import { loadUntilInteractive } from "./coldLoad.ts";
import type { ScenarioContext, ScenarioResult } from "./scenario.ts";
import { sidebarRowKeys, threadIdOf } from "./threadSwitch.ts";

export const SOAK_MAX_GAP_MS = 2_000;
const DRIVEN_KINDS = ["cursor", "claudeAgent", "codex", "opencode"] as const;
const SAMPLE_EVERY_MS = 30_000;
const STALL_LIMIT_MS = 120_000;
const RETRY_AFTER_MS = 2_000;
const MAX_DISPATCH_FAILURES = 5;
const SNAPSHOT_TIMEOUT_MS = 30_000;

const viewOf = (thread: OrchestrationThreadShell): ShellThreadView => ({
  id: thread.id,
  latestTurn:
    thread.latestTurn === null
      ? null
      : { turnId: thread.latestTurn.turnId, state: thread.latestTurn.state },
  session:
    thread.session === null
      ? null
      : { status: thread.session.status, activeTurnId: thread.session.activeTurnId },
});

interface MemorySample {
  readonly atMs: number;
  readonly heapUsedBytes: number;
  readonly heapTotalBytes: number;
  readonly serverRssBytes: number | null;
}

export async function runSoak(ctx: ScenarioContext): Promise<ScenarioResult> {
  const notes: Array<string> = [];
  const durationMs = ctx.soak.minutes * 60_000;
  const control = await ctx.control();
  const rpc = await control.openRpc();
  let scheduler: SoakTurnScheduler | null = null;
  let snapshotThreads: ReadonlyArray<OrchestrationThreadShell> = [];
  let shellItems = 0;
  const dispatchErrors: Array<string> = [];
  const retryTimers = new Set<ReturnType<typeof setTimeout>>();
  const pendingDispatches = new Set<Promise<void>>();
  let turnCounter = 0;

  const dispatchTurn = (threadId: string) => {
    turnCounter += 1;
    const atMs = Date.now();
    const sent = control
      .dispatch(
        turnStartCommand({
          id: `soak-${threadId}-${turnCounter}-${atMs}`,
          threadId,
          text: `Soak turn ${turnCounter}.`,
          atMs,
        }),
      )
      .then(
        (result) => (result.ok ? null : `${result.status}: ${result.body}`),
        (error: unknown) => String(error),
      )
      .then((failure) => {
        if (failure === null || scheduler === null) return;
        dispatchErrors.push(`${threadId} ${failure}`);
        scheduler.dispatchFailed(threadId, failure);
        if ((scheduler.summary()[threadId]?.dispatchFailures ?? 0) >= MAX_DISPATCH_FAILURES) return;
        const timer = setTimeout(() => {
          retryTimers.delete(timer);
          if (scheduler?.retry(threadId, Date.now())) dispatchTurn(threadId);
        }, RETRY_AFTER_MS);
        retryTimers.add(timer);
      })
      .finally(() => pendingDispatches.delete(sent));
    pendingDispatches.add(sent);
  };

  let snapshotReady: () => void = () => undefined;
  const snapshotArrived = new Promise<void>((resolve) => {
    snapshotReady = resolve;
  });
  const subscription = rpc.subscribeShell((item) => {
    shellItems += 1;
    if (item.kind === "snapshot") {
      snapshotThreads = item.snapshot.threads;
      for (const thread of item.snapshot.threads) scheduler?.observe(viewOf(thread), Date.now());
      snapshotReady();
    } else if (item.kind === "thread-upserted" && scheduler !== null) {
      const next = scheduler.observe(viewOf(item.thread), Date.now());
      if (next !== null) dispatchTurn(next);
    }
  });

  const context = await newMeasuredContext(ctx.browser, {
    cookies: ctx.cookies,
    motion: ctx.motion,
  });
  try {
    const arrived = await Promise.race([
      snapshotArrived.then(() => true),
      sleep(SNAPSHOT_TIMEOUT_MS).then(() => false),
    ]);
    if (!arrived) throw new Error("subscribeShell sent no snapshot");
    const driven = DRIVEN_KINDS.map((kind) => {
      const thread = snapshotThreads.find(
        (candidate) =>
          candidate.id !== ctx.seed.longThreadId &&
          candidate.id.startsWith("perf-seed-thread-") &&
          candidate.modelSelection.instanceId === kind,
      );
      if (thread === undefined) throw new Error(`no seeded thread is bound to ${kind}`);
      return { threadId: thread.id, kind };
    });
    const drivenScheduler = new SoakTurnScheduler(driven);
    for (const thread of snapshotThreads) drivenScheduler.observe(viewOf(thread), Date.now());
    scheduler = drivenScheduler;

    const page = await context.newPage();
    await loadUntilInteractive(page, () => page.goto(`${ctx.origin}/`, { waitUntil: "commit" }), 0);
    await waitForMark(page, "e6:startup:shell-live", 30_000);
    const keys = (await sidebarRowKeys(page)).filter((key) =>
      threadIdOf(key).startsWith("perf-seed-thread-"),
    );
    if (keys.length === 0) throw new Error("the sidebar rendered no seeded threads");

    const samples: Array<MemorySample> = [];
    const startedAt = Date.now();
    const takeSample = async () => {
      const heap = await heapAfterGc(page);
      const rssKb = await ctx.server.rssKb();
      samples.push({
        atMs: Date.now() - startedAt,
        heapUsedBytes: heap.usedBytes,
        heapTotalBytes: heap.totalBytes,
        serverRssBytes: rssKb === null ? null : rssKb * 1024,
      });
    };
    await takeSample();
    for (const threadId of drivenScheduler.start(Date.now())) dispatchTurn(threadId);
    ctx.log(
      `soak: ${ctx.soak.minutes} min at ×${ctx.soak.factor}, driving ${driven.map((entry) => entry.kind).join(", ")}`,
    );

    const visited = new Set<string>();
    const cycleErrors: Array<string> = [];
    let clicks = 0;
    const cycleEveryMs = ctx.soak.cycleIntervalMs;
    let nextCycleAt = 0;
    let nextSampleAt = SAMPLE_EVERY_MS;
    while (true) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= durationMs) break;
      const nextAt = Math.min(nextCycleAt, nextSampleAt, durationMs);
      if (nextAt > elapsed) await sleep(nextAt - elapsed);
      const now = Date.now() - startedAt;
      if (now >= durationMs) break;
      if (now >= nextSampleAt) {
        await takeSample();
        nextSampleAt += SAMPLE_EVERY_MS;
        ctx.log(
          `soak ${Math.round(now / 1000)} s: heap ${Math.round((samples.at(-1)?.heapUsedBytes ?? 0) / 1024 / 1024)} MB, server RSS ${Math.round((samples.at(-1)?.serverRssBytes ?? 0) / 1024 / 1024)} MB`,
        );
      }
      if (now >= nextCycleAt) {
        const key = keys[clicks % keys.length]!;
        clicks += 1;
        await page.click(`[data-thread-item] [data-sidebar-row="${key}"]`, { timeout: 5_000 }).then(
          () => visited.add(threadIdOf(key)),
          (error: unknown) => cycleErrors.push(`${threadIdOf(key)}: ${String(error)}`),
        );
        nextCycleAt += cycleEveryMs;
      }
    }
    drivenScheduler.stop();
    for (const timer of retryTimers) clearTimeout(timer);
    await takeSample();
    const stalled = drivenScheduler.stalled(Date.now(), STALL_LIMIT_MS);
    const soakWindow = { startMs: startedAt, endMs: Date.now() };
    await subscription.stop();
    const streamEnd = await subscription.ended;
    await Promise.allSettled(pendingDispatches);
    const serverMetrics = await rpc.getPerformanceMetrics().catch(() => null);
    await rpc.close();

    const summary = drivenScheduler.summary();
    const heapSeries = samples.map((sample) => ({
      atMs: sample.atMs,
      value: sample.heapUsedBytes,
    }));
    const rssSeries = samples.flatMap((sample) =>
      sample.serverRssBytes === null ? [] : [{ atMs: sample.atMs, value: sample.serverRssBytes }],
    );
    const heapGrowth = growthSlope(heapSeries);
    const rssGrowth = growthSlope(rssSeries);
    const last = samples.at(-1);
    const replayHours = (ctx.soak.minutes * ctx.soak.factor) / 60;
    const turnsByKind = Object.fromEntries(
      Object.values(summary).map((entry) => [entry.kind, entry.completed]),
    );
    const idleKinds = Object.values(summary)
      .filter((entry) => entry.completed === 0)
      .map((entry) => entry.kind);
    // A thread that gave up or ran out of dispatch retries stopped adding load before the end.
    const droppedKinds = Object.values(summary)
      .filter((entry) => entry.gaveUp || entry.dispatchFailures >= MAX_DISPATCH_FAILURES)
      .map((entry) => entry.kind);
    const flags = [
      `replayHoursEquivalent:${replayHours}`,
      ...(stalled.length > 0 ? [`stalledThreads:${stalled.length}`] : []),
      ...(idleKinds.length > 0 ? [`kindsWithoutTurns:${idleKinds.join("+")}`] : []),
      ...(droppedKinds.length > 0 ? [`kindsDroppedOut:${droppedKinds.join("+")}`] : []),
    ];
    notes.push(
      `soak: turns completed per kind ${JSON.stringify(turnsByKind)}; ${dispatchErrors.length} rejected dispatches; ${stalled.length} stalled threads`,
      `soak: the page visited ${visited.size} of ${keys.length} seeded sidebar threads, clicking every ${Math.round(cycleEveryMs)} ms`,
      "soak: the control client's shell subscription is one extra subscriber's refetch work on the server",
    );

    const metrics: Array<MetricOutcome> = [
      last === undefined
        ? { kind: "notMeasured", id: "memory.renderer.heapAfterSoak", reason: "no sample" }
        : {
            kind: "measured",
            id: "memory.renderer.heapAfterSoak",
            unit: "bytes",
            statistic: "value",
            value: last.heapUsedBytes,
            samples: samples.length,
            source:
              "cdp:Runtime.getHeapUsage usedSize after HeapProfiler.collectGarbage, end of soak",
            flags,
            points: heapSeries.map((point) => ({ label: "rendererHeap", ...point })),
          },
      last?.serverRssBytes == null
        ? {
            kind: "notMeasured",
            id: "memory.server.rssAfterSoak",
            reason: "the server's RSS could not be read at the end",
          }
        : {
            kind: "measured",
            id: "memory.server.rssAfterSoak",
            unit: "bytes",
            statistic: "value",
            value: last.serverRssBytes,
            samples: rssSeries.length,
            source: "ps -o rss= -p <captured server pid>, end of soak",
            flags,
            points: rssSeries.map((point) => ({ label: "serverRss", ...point })),
          },
      heapGrowth === null
        ? { kind: "notMeasured", id: "memory.growth", reason: "fewer than two samples" }
        : {
            kind: "measured",
            id: "memory.growth",
            unit: "bytesPerMinute",
            statistic: "series",
            value: heapGrowth.perMinute,
            samples: samples.length,
            source:
              "least-squares slope of the renderer heap after GC, sampled every 30 s; points carry both series",
            flags: [
              ...flags,
              `rendererHeapLastThirdOverFirstThird:${heapGrowth.lastThirdOverFirstThird ?? "none"}`,
              `serverRssSlopeBytesPerMinute:${rssGrowth === null ? "none" : Math.round(rssGrowth.perMinute)}`,
              `serverRssLastThirdOverFirstThird:${rssGrowth?.lastThirdOverFirstThird ?? "none"}`,
            ],
            points: [
              ...heapSeries.map((point) => ({ label: "rendererHeap", ...point })),
              ...rssSeries.map((point) => ({ label: "serverRss", ...point })),
            ],
          },
    ];

    return {
      metrics,
      idlePoints: [],
      screenshots: [],
      raw: {
        durationMs: Date.now() - startedAt,
        factor: ctx.soak.factor,
        replayHoursEquivalent: replayHours,
        maxGapMs: SOAK_MAX_GAP_MS,
        driven,
        turns: summary,
        stalled,
        dispatchErrors: dispatchErrors.slice(0, 20),
        shellItems,
        shellStreamEnded: streamEnd === null ? "stopped" : String(streamEnd),
        sidebar: {
          threads: keys.length,
          cycleIntervalMs: cycleEveryMs,
          clicks,
          visited: visited.size,
          errors: cycleErrors,
        },
        samples,
        growth: { rendererHeap: heapGrowth, serverRss: rssGrowth },
        server:
          serverMetrics === null
            ? null
            : { shell: serverMetrics.shell, rpcTotals: serverMetrics.rpcTotals },
      },
      validity: { notes },
      afterStop: async ({ home, forced }) => {
        const trace = await readServerTrace(home);
        const rates = playSegmentRates(trace.records, soakWindow);
        return {
          raw: {
            providerRate: rates,
            trace: { files: trace.files, bytes: trace.bytes, records: trace.records.length },
          },
          notes: [
            `soak: replay events/s by recording ${JSON.stringify(
              Object.fromEntries(
                Object.entries(rates).map(([recording, rate]) => [
                  recording,
                  Math.round(rate.eventsPerSecond),
                ]),
              ),
            )} from ${trace.files} trace files${trace.files > 1 ? " (the trace rotated, so these are the surviving tail's segments)" : ""}${forced ? " (the server was killed; the last spans may be missing)" : ""}`,
          ],
        };
      },
    };
  } finally {
    scheduler?.stop();
    for (const timer of retryTimers) clearTimeout(timer);
    await subscription.stop().catch(() => undefined);
    await rpc.close().catch(() => undefined);
    await context.close();
  }
}
