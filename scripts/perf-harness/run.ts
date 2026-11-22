#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off globalRandom:off - host-side harness CLI that orchestrates processes, a browser and files.
/**
 * The web performance harness (ENG-128). Seeds one throwaway home, then runs
 * each selected scenario against its own server on a copy of it, in headless
 * Chromium, and writes one JSON report validated against
 * `@e6tools/shared/perfReport`. It never touches the live E6 home, never sets
 * `VITE_HTTP_URL`/`VITE_WS_URL`, and stops only the PIDs it spawned.
 *
 *   node scripts/perf-harness/run.ts [--scenario all|coldLoad,threadSwitch,...] [--out <dir>]
 *     [--build] [--variant legacy] [--motion full|reduced|off] [--screenshots]
 *     [--keep-home] [--keep-traces] [--stop-timeout <seconds>]
 *     [--threads 50] [--long-thread-turns 1000] [--turns-per-thread 4]
 *     [--long-thread-shape turns|imported-messages] [--soak-minutes 6] [--soak-factor 32]
 *
 * The report is written even when a scenario fails: its rows become
 * `notMeasured` with the failure. Scenarios not built yet or not selected
 * report "scenario not run".
 *
 * @module perf-harness/run
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodePerfHooks from "node:perf_hooks";
import * as NodeProcess from "node:process";
import * as NodeUtil from "node:util";

import { DEFAULT_MODEL, DEFAULT_MODEL_BY_PROVIDER, ProviderDriverKind } from "@e6tools/contracts";
import type { PerfReport, PerfScenarioId } from "@e6tools/shared/perfReport";
import type { Browser, Cookie } from "playwright-core";

import { pairBrowser, issuePairingCredential } from "./auth.ts";
import {
  frameCadenceProbe,
  launchBrowser,
  VIEWPORT,
  type BrowserInfo,
  type MotionRequest,
} from "./browser.ts";
import { checkProductionBuild, isWebBuildStale } from "./bundle.ts";
import { buildReport, encodeReport, SCENARIO_IDS, type ScenarioRecord } from "./report.ts";
import {
  buildServerSettings,
  checkOutDir,
  createRunRoot,
  isIgnoredByGit,
  realPathThroughAncestors,
  REPO_ROOT,
  scenarioHome,
  type RunRoot,
} from "./runRoot.ts";
import { REMOTE_PROFILE, runColdLoad } from "./scenarios/coldLoad.ts";
import type { ScenarioContext, ScenarioResult } from "./scenarios/scenario.ts";
import { runThreadSwitch } from "./scenarios/threadSwitch.ts";
import {
  listenersOn,
  runNodeScript,
  startServer,
  stopAllChildren,
  type ServerHandle,
} from "./serverProcess.ts";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

const BUILT_SCENARIOS: Partial<
  Record<PerfScenarioId, (ctx: ScenarioContext) => Promise<ScenarioResult>>
> = {
  coldLoad: runColdLoad,
  threadSwitch: runThreadSwitch,
};

const RECORDINGS_DIR = NodePath.join(
  REPO_ROOT,
  "packages/shared/src/testing/providerReplay/recordings",
);
const RECORDINGS = [
  "cursor.streaming-prose",
  "claude.approval-flow",
  "codex.subagent-fleet",
  "opencode.tool-heavy",
];
const REPLAYED_KINDS = ["cursor", "claudeAgent", "codex", "opencode"];
const STREAM_RECORDING = "cursor.streaming-prose";
const STREAM_EVENTS_PER_SECOND = 50;
const SEED_SCRIPT = NodePath.join(REPO_ROOT, "apps/server/scripts/perf-seed.ts");
const ROUTE_TREE = "apps/web/src/routeTree.gen.ts";
const PROVIDER_CLI_NAMES = new Set([
  "claude",
  "codex",
  "cursor-agent",
  "cursor",
  "opencode",
  "grok",
  "gemini",
  "agy",
  "antigravity",
]);
const SERVER_CHILD_SAMPLE_MS = 10_000;

const USAGE = `Usage: node scripts/perf-harness/run.ts [options]

  --scenario <list|all>      coldLoad, threadSwitch, streamingInput, timelineScroll, soak (default all)
  --out <dir>                report directory (default $TMPDIR/e6-perf/<runId>); outside the repo or git-ignored
  --build                    build apps/web first
  --variant legacy|v2        UI variant (default legacy)
  --motion full|reduced|off  Motion setting the page boots with (default full)
  --screenshots              capture each scenario's screenshot points
  --keep-home                keep the run root (homes, workspace, logs)
  --keep-traces              write CDP traces to <out>/traces
  --stop-timeout <seconds>   SIGTERM grace before SIGKILL (default 10)
  --threads <n>              seeded threads (default 50)
  --long-thread-turns <n>    turns on the long thread (default 1000)
  --turns-per-thread <n>     turns on the other threads (default 4)
  --long-thread-shape turns|imported-messages
  --soak-minutes <n>, --soak-factor <n>   recorded in the report; the soak is not built yet
`;

interface Options {
  readonly scenarios: ReadonlySet<PerfScenarioId>;
  readonly out: string | null;
  readonly build: boolean;
  readonly variant: "legacy" | "v2";
  readonly motion: MotionRequest;
  readonly screenshots: boolean;
  readonly keepHome: boolean;
  readonly keepTraces: boolean;
  readonly stopTimeoutMs: number;
  readonly threads: number;
  readonly longThreadTurns: number;
  readonly turnsPerThread: number;
  readonly longThreadShape: "turns" | "imported-messages";
  readonly soakMinutes: number;
  readonly soakFactor: number;
}

class UsageError extends Error {}

function positive(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new UsageError(`--${name} must be a positive number`);
  return parsed;
}

function oneOf<A extends string>(
  name: string,
  value: string | undefined,
  allowed: ReadonlyArray<A>,
  fallback: A,
): A {
  if (value === undefined) return fallback;
  if (!allowed.includes(value as A)) {
    throw new UsageError(`--${name} must be one of ${allowed.join(", ")}`);
  }
  return value as A;
}

function parseOptions(argv: ReadonlyArray<string>): Options {
  const { values } = NodeUtil.parseArgs({
    args: [...argv],
    options: {
      scenario: { type: "string" },
      out: { type: "string" },
      build: { type: "boolean" },
      variant: { type: "string" },
      motion: { type: "string" },
      screenshots: { type: "boolean" },
      "keep-home": { type: "boolean" },
      "keep-traces": { type: "boolean" },
      "stop-timeout": { type: "string" },
      threads: { type: "string" },
      "long-thread-turns": { type: "string" },
      "turns-per-thread": { type: "string" },
      "long-thread-shape": { type: "string" },
      "soak-minutes": { type: "string" },
      "soak-factor": { type: "string" },
      help: { type: "boolean" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  const requested = (values.scenario ?? "all").split(",").map((entry) => entry.trim());
  const scenarios = requested.includes("all")
    ? new Set(SCENARIO_IDS)
    : new Set(
        requested.map((entry) => {
          if (!SCENARIO_IDS.includes(entry as PerfScenarioId)) {
            throw new UsageError(
              `unknown scenario '${entry}'; expected ${SCENARIO_IDS.join(", ")} or all`,
            );
          }
          return entry as PerfScenarioId;
        }),
      );
  const threads = Math.floor(positive("threads", values.threads, 50));
  return {
    scenarios,
    out: values.out ?? null,
    build: values.build ?? false,
    variant: oneOf("variant", values.variant, ["legacy", "v2"], "legacy"),
    motion: oneOf("motion", values.motion, ["full", "reduced", "off"], "full"),
    screenshots: values.screenshots ?? false,
    keepHome: values["keep-home"] ?? false,
    keepTraces: values["keep-traces"] ?? false,
    stopTimeoutMs: positive("stop-timeout", values["stop-timeout"], 10) * 1000,
    threads,
    longThreadTurns: Math.floor(positive("long-thread-turns", values["long-thread-turns"], 1000)),
    turnsPerThread: Math.floor(positive("turns-per-thread", values["turns-per-thread"], 4)),
    longThreadShape: oneOf(
      "long-thread-shape",
      values["long-thread-shape"],
      ["turns", "imported-messages"],
      "turns",
    ),
    soakMinutes: positive("soak-minutes", values["soak-minutes"], 6),
    soakFactor: positive("soak-factor", values["soak-factor"], 32),
  };
}

const log = (message: string) => process.stdout.write(`[perf] ${message}\n`);
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function gitInfo(): Promise<PerfReport["git"]> {
  const git = (args: ReadonlyArray<string>) =>
    execFile("git", [...args], { cwd: REPO_ROOT }).then(
      ({ stdout }) => stdout.trim(),
      () => null,
    );
  const [commit, branch, status] = await Promise.all([
    git(["rev-parse", "HEAD"]),
    git(["rev-parse", "--abbrev-ref", "HEAD"]),
    git(["status", "--porcelain"]),
  ]);
  return { commit, branch, dirty: status === null ? null : status.length > 0 };
}

/** Builds `apps/web` without `VITE_` or `E6CODE_` variables; restores the route tree it rewrites. */
async function buildWeb(): Promise<void> {
  const routeTreeWasClean = await execFile("git", ["diff", "--quiet", "--", ROUTE_TREE], {
    cwd: REPO_ROOT,
  }).then(
    () => true,
    () => false,
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        value !== undefined && !key.startsWith("VITE_") && !key.startsWith("E6CODE_"),
    ),
  );
  log("building apps/web");
  await new Promise<void>((resolve, reject) => {
    const child = NodeChildProcess.spawn(
      NodePath.join(REPO_ROOT, "node_modules/.bin/vp"),
      ["run", "--filter", "@e6tools/web", "build"],
      { cwd: REPO_ROOT, env, stdio: ["ignore", "inherit", "inherit"] },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`web build exited ${code}`)),
    );
  });
  if (routeTreeWasClean) {
    await execFile("git", ["checkout", "--", ROUTE_TREE], { cwd: REPO_ROOT });
  }
}

/** Modification times of live-home files the harness must never write. */
function liveHomeStamp(liveHomes: ReadonlyArray<string>): Record<string, number | null> {
  const stamp: Record<string, number | null> = {};
  for (const home of liveHomes) {
    for (const relative of [
      "userdata/secrets",
      "userdata/settings.json",
      "userdata/state.sqlite",
    ]) {
      const path = NodePath.join(home, relative);
      stamp[path] = NodeFS.existsSync(path) ? NodeFS.statSync(path).mtimeMs : null;
    }
  }
  return stamp;
}

/** Check 7.10: no session or turn-start events appended after the seed, before the browser. */
async function seedInert(home: string, maxSequence: number): Promise<Record<string, unknown>> {
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(NodePath.join(home, "userdata/state.sqlite"), {
    readOnly: true,
  });
  try {
    const row = database
      .prepare(
        `SELECT COUNT(*) AS appended,
                COALESCE(SUM(event_type IN ('thread.session-set', 'thread.turn-start-requested')), 0) AS offending
           FROM orchestration_events WHERE sequence > ?`,
      )
      .get(maxSequence) as { readonly appended: number; readonly offending: number } | undefined;
    return {
      maxSequence,
      appended: row?.appended ?? null,
      sessionOrTurnStart: row?.offending ?? null,
    };
  } finally {
    database.close();
  }
}

/** Check 7.9: the file secret store was used (a key on disk, no keychain marker). */
async function secretStoreUsed(home: string): Promise<Record<string, unknown>> {
  const dir = NodePath.join(home, "userdata/secrets");
  const entries = await NodeFSP.readdir(dir).catch((): Array<string> => []);
  return {
    signingKeyOnDisk: entries.includes("server-signing-key.bin"),
    keychainMarkers: entries.filter((entry) => entry.endsWith(".keychain")),
  };
}

interface SeedSummary {
  readonly durationMs: number;
  readonly projectId: string;
  readonly longThreadId: string | null;
  readonly threads: number;
  readonly maxSequence: number;
}

async function seedTemplate(runRoot: RunRoot, options: Options, logDir: string) {
  log(`seeding ${options.threads} threads, ${options.longThreadTurns} turns on the long one`);
  const run = await runNodeScript(
    [
      SEED_SCRIPT,
      "--base-dir",
      runRoot.templateHome,
      "--workspace",
      runRoot.workspace,
      "--threads",
      String(options.threads),
      "--long-thread-turns",
      String(options.longThreadTurns),
      "--turns-per-thread",
      String(options.turnsPerThread),
      "--provider",
      REPLAYED_KINDS.join(","),
      "--long-thread-shape",
      options.longThreadShape,
    ],
    { env: runRoot.childEnv(), cwd: runRoot.workspace, logPath: NodePath.join(logDir, "seed.log") },
  );
  const summaryLine = run.lines.toReversed().find((line) => line.trim().startsWith("{"));
  if (summaryLine === undefined) throw new Error("the seed printed no summary");
  const summary = JSON.parse(summaryLine) as SeedSummary;
  const model = DEFAULT_MODEL_BY_PROVIDER[ProviderDriverKind.make("cursor")] ?? DEFAULT_MODEL;
  const settings = buildServerSettings({
    replayedKinds: REPLAYED_KINDS,
    defaultModel: { instanceId: "cursor", model },
  });
  await NodeFSP.writeFile(
    NodePath.join(runRoot.templateHome, "userdata/settings.json"),
    `${JSON.stringify(settings, null, 2)}\n`,
  );
  return { summary, pid: run.pid, wallMs: run.ms };
}

const skipped = (id: PerfScenarioId, reason: string): ScenarioRecord => ({
  id,
  status: "skipped",
  error: null,
  startedAt: null,
  wallTimeMs: null,
  raw: { reason },
  screenshots: [],
  metrics: [],
  idlePoints: [],
});

async function main(): Promise<number> {
  let options: Options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n\n${USAGE}`);
    return 2;
  }
  if (options.variant === "v2") {
    process.stderr.write(
      "no v2 screens registered (flags.ts absent; redesignedScreens.ts returns false)\n",
    );
    return 2;
  }

  const runStartedAt = new Date();
  const runStartMs = NodePerfHooks.performance.now();
  const runId = `${runStartedAt.toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
  const outDir = realPathThroughAncestors(
    options.out ?? NodePath.join(NodeOS.tmpdir(), "e6-perf", runId),
  );
  const outCheck = checkOutDir({
    outDir,
    repoRoot: realPathThroughAncestors(REPO_ROOT),
    ignoredByGit: await isIgnoredByGit(outDir),
  });
  if (!outCheck.ok) {
    process.stderr.write(`refusing --out: ${outCheck.reason}\n`);
    return 2;
  }
  const logDir = NodePath.join(outDir, "logs");
  await NodeFSP.mkdir(logDir, { recursive: true });
  const traceDir = options.keepTraces ? NodePath.join(outDir, "traces") : null;
  log(`run ${runId}; report in ${outDir}`);

  const git = await gitInfo();
  if (options.build) await buildWeb();
  const distDir = NodePath.join(REPO_ROOT, "apps/web/dist");
  if (!NodeFS.existsSync(NodePath.join(distDir, "index.html"))) {
    process.stderr.write(`no web build at ${distDir}; run with --build\n`);
    return 2;
  }
  const stale = await isWebBuildStale(distDir, REPO_ROOT);
  if (stale) log("warning: apps/web/dist is older than the web client's sources; pass --build");

  const runRoot = await createRunRoot();
  log(`run root ${runRoot.root}`);
  const liveBefore = liveHomeStamp(runRoot.liveHomes);
  let browser: Browser | null = null;
  let interrupted = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (interrupted) return;
    interrupted = true;
    log(`${signal}: stopping the processes this run started`);
    void (async () => {
      await stopAllChildren(options.stopTimeoutMs);
      await browser?.close().catch(() => undefined);
      if (!options.keepHome) await NodeFSP.rm(runRoot.root, { recursive: true, force: true });
      process.exit(signal === "SIGINT" ? 130 : 143);
    })();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const notes: Array<string> = [];
  const processes: Array<PerfReport["processes"][number]> = [];
  const records: Array<ScenarioRecord> = [];
  let browserInfo: BrowserInfo = { binary: "headless-shell", revision: null, version: null };
  let seed: Awaited<ReturnType<typeof seedTemplate>> | null = null;
  let setupError: string | null = null;
  let frameCadence: Awaited<ReturnType<typeof frameCadenceProbe>> | null = null;
  let productionBuild: boolean | null = null;
  const validity = {
    motionResolved: null as string | null,
    eventTimingObserved: false,
    proxySelfTest: null as { rttMs: number; mbps: number } | null,
    addedRpcRoundTripMs: null as number | null,
  };

  try {
    seed = await seedTemplate(runRoot, options, logDir);
    processes.push({ role: "seed", scenario: null, pid: seed.pid, port: null, stop: null });
    log(`seeded in ${Math.round(seed.summary.durationMs)} ms`);
    const launched = await launchBrowser();
    browser = launched.browser;
    browserInfo = launched.info;
    frameCadence = await frameCadenceProbe(browser, traceDir);
    log(`frame cadence p50 ${frameCadence.p50Ms ?? "n/a"} ms from ${frameCadence.source}`);
  } catch (error) {
    setupError = errorMessage(error);
    log(`setup failed: ${setupError}`);
  }

  for (const id of SCENARIO_IDS) {
    if (!options.scenarios.has(id)) {
      records.push(skipped(id, "not selected"));
      continue;
    }
    const run = BUILT_SCENARIOS[id];
    if (run === undefined) {
      records.push(skipped(id, "not built yet (ENG-128 phase C)"));
      continue;
    }
    const startedAt = new Date().toISOString();
    const startMs = NodePerfHooks.performance.now();
    if (setupError !== null || seed === null || browser === null) {
      records.push({
        ...skipped(id, "setup failed"),
        status: "failed",
        error: `setup failed: ${setupError ?? "unknown"}`,
        startedAt,
      });
      continue;
    }
    log(`scenario ${id}`);
    let server: ServerHandle | null = null;
    const serverRaw: Record<string, unknown> = {};
    const children = new Set<string>();
    let childSampler: ReturnType<typeof setInterval> | null = null;
    let home: string | null = null;
    try {
      home = await scenarioHome(runRoot, id);
      const scenarioHomeDir = home;
      const env = runRoot.childEnv({
        E6CODE_PROVIDER_REPLAY: RECORDINGS.map((recording) =>
          NodePath.join(RECORDINGS_DIR, `${recording}.ndjson`),
        ).join(","),
        E6CODE_PROVIDER_REPLAY_ON_EXHAUSTED: "loop",
        E6CODE_PROVIDER_REPLAY_AUTO_RESPOND: "true",
      });
      server = await startServer({
        home: scenarioHomeDir,
        env,
        cwd: runRoot.workspace,
        logPath: NodePath.join(logDir, `${id}.server.log`),
      });
      const started = server;
      log(
        `server pid ${started.pid} on port ${started.port}, ready in ${Math.round(started.readyMs)} ms`,
      );
      const sample = async () => {
        for (const command of await started.childCommands()) children.add(command);
      };
      childSampler = setInterval(() => void sample(), SERVER_CHILD_SAMPLE_MS);
      serverRaw.readyMs = started.readyMs;
      serverRaw.rssKbAtReady = await started.rssKb();
      serverRaw.replayActive = started.lines.filter((line) =>
        line.includes("provider replay active"),
      );
      serverRaw.seedInert = await seedInert(scenarioHomeDir, seed.summary.maxSequence).catch(
        (error: unknown) => ({
          error: errorMessage(error),
        }),
      );
      if (productionBuild === null) {
        const check = await checkProductionBuild(started.origin, distDir);
        productionBuild = check.productionBuild;
        notes.push(...check.notes);
      }
      const { credential, pid: authPid } = await issuePairingCredential({
        home: scenarioHomeDir,
        env,
        cwd: runRoot.workspace,
        logDir,
      });
      processes.push({ role: "auth", scenario: id, pid: authPid, port: null, stop: null });
      const activeBrowser = browser;
      const pairAt = async (origin: string): Promise<Array<Cookie>> => {
        const fresh = await issuePairingCredential({
          home: scenarioHomeDir,
          env,
          cwd: runRoot.workspace,
          logDir,
        });
        processes.push({ role: "auth", scenario: id, pid: fresh.pid, port: null, stop: null });
        return pairBrowser(activeBrowser, {
          origin,
          credential: fresh.credential,
          motion: options.motion,
        });
      };
      const cookies = await pairBrowser(activeBrowser, {
        origin: started.origin,
        credential,
        motion: options.motion,
      });
      const result = await run({
        browser: activeBrowser,
        origin: started.origin,
        serverPort: started.port,
        cookies,
        pairAt,
        motion: options.motion,
        distDir,
        outDir,
        traceDir,
        screenshots: options.screenshots,
        seed: {
          projectId: seed.summary.projectId,
          longThreadId: seed.summary.longThreadId,
          threads: seed.summary.threads,
        },
        log: (message) => log(`  ${message}`),
      });
      await sample();
      serverRaw.rssKbAtEnd = await started.rssKb();
      if (result.validity.motionResolved !== undefined && validity.motionResolved === null) {
        validity.motionResolved = result.validity.motionResolved;
      }
      if (result.validity.eventTimingObserved) validity.eventTimingObserved = true;
      if (result.validity.proxySelfTest !== undefined) {
        validity.proxySelfTest = result.validity.proxySelfTest;
      }
      if (result.validity.addedRpcRoundTripMs !== undefined) {
        validity.addedRpcRoundTripMs = result.validity.addedRpcRoundTripMs;
      }
      notes.push(...(result.validity.notes ?? []));
      records.push({
        id,
        status: "passed",
        error: null,
        startedAt,
        wallTimeMs: NodePerfHooks.performance.now() - startMs,
        raw: { ...result.raw, server: serverRaw },
        screenshots: result.screenshots,
        metrics: result.metrics,
        idlePoints: result.idlePoints,
      });
    } catch (error) {
      log(`scenario ${id} failed: ${errorMessage(error)}`);
      records.push({
        ...skipped(id, "failed"),
        status: "failed",
        error: errorMessage(error),
        startedAt,
        wallTimeMs: NodePerfHooks.performance.now() - startMs,
        raw: { server: serverRaw },
      });
    } finally {
      if (childSampler !== null) clearInterval(childSampler);
      if (server !== null) {
        const stop = await server.stop(options.stopTimeoutMs);
        log(
          `server pid ${server.pid} stopped by ${stop.signal} after ${Math.round(stop.exitedAfterMs ?? -1)} ms`,
        );
        processes.push({ role: "server", scenario: id, pid: server.pid, port: server.port, stop });
        serverRaw.listenersAfterStop = await listenersOn(server.port);
        if (home !== null) serverRaw.secretStore = await secretStoreUsed(home);
        serverRaw.children = [...children].toSorted();
        const providerChildren = [...children].filter((command) => PROVIDER_CLI_NAMES.has(command));
        if (providerChildren.length > 0) {
          notes.push(`hermetic providers: server ${id} spawned ${providerChildren.join(", ")}`);
        }
      }
    }
  }

  await browser?.close().catch(() => undefined);
  const liveAfter = liveHomeStamp(runRoot.liveHomes);
  const changed = Object.keys(liveBefore).filter((path) => liveBefore[path] !== liveAfter[path]);
  notes.push(
    changed.length === 0
      ? "live home: watched files unchanged"
      : `live home: changed during the run (a running live server also writes state.sqlite): ${changed.join(", ")}`,
  );
  if (frameCadence !== null) {
    notes.push(
      `frame cadence probe: ${frameCadence.frames} frames from ${frameCadence.source}, p50 ${frameCadence.p50Ms ?? "n/a"} ms`,
    );
  }
  if (validity.motionResolved === null) {
    notes.push(
      `motion: requested ${options.motion}; no data-motion attribute (legacy screens do not read the Motion setting)`,
    );
  }
  if (setupError !== null) notes.push(`setup failed: ${setupError}`);

  const frameMetricTrusted =
    frameCadence !== null &&
    frameCadence.source === "PipelineReporter" &&
    frameCadence.p50Ms !== null &&
    Math.abs(frameCadence.p50Ms - 1000 / 60) <= 1.5;
  const finishedAt = new Date();
  const report = buildReport({
    runId,
    startedAt: runStartedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    wallTimeMs: NodePerfHooks.performance.now() - runStartMs,
    git,
    machine: {
      platform: NodeProcess.platform,
      arch: NodeProcess.arch,
      cpus: NodeOS.cpus().length,
      cpuModel: NodeOS.cpus()[0]?.model ?? "unknown",
      memoryGb: Math.round((NodeOS.totalmem() / 1024 ** 3) * 10) / 10,
      node: process.version,
      chromium: browserInfo,
    },
    options: {
      variant: options.variant,
      motion: { requested: options.motion, resolved: validity.motionResolved },
      responseStreamingMode: "paragraph",
      stream: { recordingId: STREAM_RECORDING, eventsPerSecond: STREAM_EVENTS_PER_SECOND },
      remote: { mechanism: "tcp-proxy", ...REMOTE_PROFILE },
      soak: {
        minutes: options.soakMinutes,
        factor: options.soakFactor,
        replayHoursEquivalent: (options.soakMinutes * options.soakFactor) / 60,
        activeThreads: 4,
        threads: options.threads,
      },
      viewport: VIEWPORT,
    },
    webBuild: {
      distPath: distDir,
      builtByHarness: options.build,
      commit: options.build ? git.commit : null,
      stale: options.build ? false : stale,
    },
    validity: {
      productionBuild: productionBuild ?? false,
      frameCadenceMs: { p50: frameCadence?.p50Ms ?? null },
      frameMetricTrusted,
      proxySelfTest: validity.proxySelfTest,
      addedRpcRoundTripMs: validity.addedRpcRoundTripMs,
      eventTimingObserved: validity.eventTimingObserved,
      notes,
    },
    seed: {
      durationMs: seed?.summary.durationMs ?? 0,
      threads: options.threads,
      longThreadTurns: options.longThreadTurns,
      longThreadShape: options.longThreadShape,
    },
    scenarios: records,
    processes,
  });

  const reportPath = NodePath.join(outDir, "report.json");
  try {
    await NodeFSP.writeFile(reportPath, encodeReport(report));
    log(`report ${reportPath} (${Math.round(report.wallTimeMs / 1000)} s)`);
  } catch (error) {
    const invalidPath = NodePath.join(outDir, "report.invalid.json");
    await NodeFSP.writeFile(
      invalidPath,
      `${JSON.stringify({ error: errorMessage(error), report }, null, 2)}\n`,
    );
    log(`the report failed schema validation; wrote ${invalidPath}`);
    return 1;
  } finally {
    if (!options.keepHome) await NodeFSP.rm(runRoot.root, { recursive: true, force: true });
    else log(`kept run root ${runRoot.root}`);
  }
  return records.some((record) => record.status === "failed") ? 1 : 0;
}

if (import.meta.main) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      void stopAllChildren(5_000).then(() => process.exit(1));
    },
  );
}
