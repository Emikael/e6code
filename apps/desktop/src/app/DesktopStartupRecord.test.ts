import { STARTUP_MARK_PREFIX as SHARED_STARTUP_MARK_PREFIX } from "@e6tools/shared/startupMarks";
import { describe, expect, it } from "vite-plus/test";

import { STARTUP_MARK_PREFIX } from "../ipc/channels.ts";
import { REQUIRED_STARTUP_PHASES, StartupClock } from "./DesktopStartupClock.ts";
import {
  applyRendererStartupMark,
  buildStartupRecord,
  classifyAppMetrics,
  isStartupSettled,
  parseProcessWorkingSetKiB,
  type StartupRecordContext,
} from "./DesktopStartupRecord.ts";

const PROCESS_CREATED_EPOCH_MS = 1_800_000_000_000;

const makeClock = () => {
  let now = 0;
  const clock = new StartupClock({
    processCreatedEpochMs: PROCESS_CREATED_EPOCH_MS,
    nodeTimeOriginEpochMs: PROCESS_CREATED_EPOCH_MS + 40,
    now: () => now,
  });
  return {
    clock,
    advanceTo: (nodeMs: number) => {
      now = nodeMs;
    },
  };
};

const context: StartupRecordContext = {
  runId: "run",
  pid: 42,
  app: {
    version: "0.0.46",
    platform: "darwin",
    arch: "arm64",
    isPackaged: true,
    isDevelopment: false,
  },
  launch: {
    localEnvironmentEnabled: true,
    wslOnly: false,
    wslBackendEnabled: false,
    environmentIdKnown: true,
  },
};

describe("StartupClock", () => {
  it("measures from process creation and keeps the first stamp of a phase", () => {
    const { clock, advanceTo } = makeClock();
    advanceTo(10);
    clock.reach("electronReady");
    advanceTo(500);
    clock.reach("electronReady");

    expect(clock.origin.nodeTimeOriginOffsetMs).toBe(40);
    expect(clock.get("electronReady")).toEqual({ status: "reached", atMs: 50 });
    expect(clock.fromEpochMs(PROCESS_CREATED_EPOCH_MS + 300)).toBe(300);
  });

  it("falls back to Node's time origin when process creation is unknown", () => {
    const clock = new StartupClock({
      processCreatedEpochMs: null,
      nodeTimeOriginEpochMs: PROCESS_CREATED_EPOCH_MS,
      now: () => 25,
    });

    expect(clock.origin.origin).toBe("node-time-origin");
    expect(clock.nowMs()).toBe(25);
    expect(clock.fromEpochMs(PROCESS_CREATED_EPOCH_MS + 300)).toBe(300);
  });
});

describe("startup record", () => {
  it("settles once every required phase is reached or not applicable", () => {
    const { clock } = makeClock();
    for (const phase of REQUIRED_STARTUP_PHASES.filter((phase) => phase !== "backendReady")) {
      clock.reach(phase);
    }
    expect(isStartupSettled(clock)).toBe(false);

    clock.notApplicable("backendReady", "local-environment-disabled");
    expect(isStartupSettled(clock)).toBe(true);
  });

  it("waits for the live shell once the cached shell and the backend are both up", () => {
    const { clock } = makeClock();
    for (const phase of REQUIRED_STARTUP_PHASES) clock.reach(phase);
    expect(isStartupSettled(clock)).toBe(false);

    clock.reach("shellLive");
    expect(isStartupSettled(clock)).toBe(true);
  });

  it("does not wait for a live shell that cannot come", () => {
    const welcome = makeClock().clock;
    for (const phase of REQUIRED_STARTUP_PHASES.filter((phase) => phase !== "shellInteractive")) {
      welcome.reach(phase);
    }
    welcome.notApplicable("shellInteractive", "landing:welcome");
    expect(isStartupSettled(welcome)).toBe(true);
  });

  it("lists every phase, marking unresolved ones with why the record was written", () => {
    const { clock, advanceTo } = makeClock();
    clock.reach("mainEntry");
    advanceTo(120_000);

    const record = buildStartupRecord({ context, clock, outcome: "deadline" });

    expect(record.type).toBe("desktop-startup");
    expect(record.writtenAtMs).toBe(120_040);
    expect(record.phases.mainEntry.status).toBe("reached");
    expect(record.phases.backendReady).toEqual({ status: "not-reached", reason: "deadline" });
    expect(record.phases.rendererLanding).toEqual({ status: "not-reached", reason: "deadline" });
    expect(Object.keys(record.phases)).toEqual(
      expect.arrayContaining([...REQUIRED_STARTUP_PHASES]),
    );
  });
});

describe("renderer startup marks", () => {
  it("places paint entries on the main process clock", () => {
    const { clock } = makeClock();
    applyRendererStartupMark(clock, {
      name: "first-paint",
      epochMs: PROCESS_CREATED_EPOCH_MS + 280.5,
    });

    expect(clock.get("rendererFirstPaint")).toEqual({ status: "reached", atMs: 280.5 });
  });

  it("rules out the shell when the renderer lands outside the app", () => {
    const { clock } = makeClock();
    applyRendererStartupMark(clock, {
      name: "e6:startup:landing:welcome",
      epochMs: PROCESS_CREATED_EPOCH_MS + 900,
    });
    applyRendererStartupMark(clock, {
      name: "e6:startup:shell-interactive:live",
      epochMs: PROCESS_CREATED_EPOCH_MS + 1_500,
    });

    expect(clock.get("rendererLanding")).toEqual({
      status: "reached",
      atMs: 900,
      landing: "welcome",
    });
    expect(clock.get("shellInteractive")).toEqual({
      status: "not-applicable",
      reason: "landing:welcome",
    });
  });

  it("records the shell sync status when it lands in the app", () => {
    const { clock } = makeClock();
    applyRendererStartupMark(clock, {
      name: "e6:startup:landing:app",
      epochMs: PROCESS_CREATED_EPOCH_MS + 900,
    });
    expect(clock.get("shellInteractive")).toBeUndefined();

    applyRendererStartupMark(clock, {
      name: "e6:startup:shell-interactive:cached",
      epochMs: PROCESS_CREATED_EPOCH_MS + 1_100,
    });
    applyRendererStartupMark(clock, { name: "unrelated", epochMs: PROCESS_CREATED_EPOCH_MS });

    expect(clock.get("shellInteractive")).toEqual({
      status: "reached",
      atMs: 1_100,
      syncStatus: "cached",
    });
  });

  it("records where the interactive shell's snapshots came from, and when it went live", () => {
    const { clock } = makeClock();
    applyRendererStartupMark(clock, {
      name: "e6:startup:shell-interactive:synchronizing:cache",
      epochMs: PROCESS_CREATED_EPOCH_MS + 700,
    });
    applyRendererStartupMark(clock, {
      name: "e6:startup:shell-live",
      epochMs: PROCESS_CREATED_EPOCH_MS + 4_000,
    });

    expect(clock.get("shellInteractive")).toEqual({
      status: "reached",
      atMs: 700,
      syncStatus: "synchronizing",
      source: "cache",
    });
    expect(clock.get("shellLive")).toEqual({ status: "reached", atMs: 4_000 });
  });

  it("records the surface the renderer lands on after the starting panel", () => {
    const { clock } = makeClock();
    applyRendererStartupMark(clock, {
      name: "e6:startup:landing:starting",
      epochMs: PROCESS_CREATED_EPOCH_MS + 500,
    });
    expect(clock.get("rendererLanding")).toEqual({
      status: "reached",
      atMs: 500,
      landing: "starting",
    });
    // The panel gives way to a surface, so it does not rule the shell out.
    expect(clock.get("shellInteractive")).toBeUndefined();

    applyRendererStartupMark(clock, {
      name: "e6:startup:landing:welcome",
      epochMs: PROCESS_CREATED_EPOCH_MS + 9_000,
    });
    expect(clock.get("rendererLanding")).toEqual({
      status: "reached",
      atMs: 9_000,
      landing: "welcome",
    });
    expect(clock.get("shellInteractive")).toEqual({
      status: "not-applicable",
      reason: "landing:welcome",
    });

    // The real landing then keeps its first stamp, like every phase.
    applyRendererStartupMark(clock, {
      name: "e6:startup:landing:app",
      epochMs: PROCESS_CREATED_EPOCH_MS + 9_500,
    });
    expect(clock.get("rendererLanding")).toMatchObject({ landing: "welcome" });
  });

  it("keeps the app landing after the starting panel open for the shell", () => {
    const { clock } = makeClock();
    applyRendererStartupMark(clock, {
      name: "e6:startup:landing:starting",
      epochMs: PROCESS_CREATED_EPOCH_MS + 500,
    });
    applyRendererStartupMark(clock, {
      name: "e6:startup:landing:app",
      epochMs: PROCESS_CREATED_EPOCH_MS + 7_000,
    });
    applyRendererStartupMark(clock, {
      name: "e6:startup:shell-interactive:live:server",
      epochMs: PROCESS_CREATED_EPOCH_MS + 7_200,
    });

    expect(clock.get("rendererLanding")).toEqual({
      status: "reached",
      atMs: 7_000,
      landing: "app",
    });
    expect(clock.get("shellInteractive")).toEqual({
      status: "reached",
      atMs: 7_200,
      syncStatus: "live",
      source: "server",
    });
  });

  it("keeps the starting landing when nothing else lands", () => {
    const { clock } = makeClock();
    applyRendererStartupMark(clock, {
      name: "e6:startup:landing:starting",
      epochMs: PROCESS_CREATED_EPOCH_MS + 500,
    });
    applyRendererStartupMark(clock, {
      name: "e6:startup:landing:starting",
      epochMs: PROCESS_CREATED_EPOCH_MS + 800,
    });
    expect(clock.get("rendererLanding")).toEqual({
      status: "reached",
      atMs: 500,
      landing: "starting",
    });
  });

  it("forwards the same mark prefix the web client sets", () => {
    expect(STARTUP_MARK_PREFIX).toBe(SHARED_STARTUP_MARK_PREFIX);
  });
});

describe("memory sample", () => {
  it("groups Electron processes by type and converts kilobytes to bytes", () => {
    const metric = (pid: number, type: string, kib: number) => ({
      pid,
      type,
      memory: { workingSetSize: kib, peakWorkingSetSize: kib * 2 },
    });
    const memory = classifyAppMetrics(
      [
        metric(1, "Browser", 100),
        metric(2, "GPU", 50),
        metric(3, "Tab", 200),
        metric(4, "Tab", 30),
        metric(5, "Tab", 20),
        metric(6, "Utility", 10),
        metric(7, "Zygote", 5),
      ],
      3,
    );

    expect(memory.main).toEqual({
      count: 1,
      workingSetBytes: 102_400,
      peakWorkingSetBytes: 204_800,
      pids: [1],
    });
    expect(memory.rendererMain.pids).toEqual([3]);
    expect(memory.rendererOther).toMatchObject({ count: 2, workingSetBytes: 51_200, pids: [4, 5] });
    expect(memory.gpu.workingSetBytes).toBe(51_200);
    expect(memory.utility.pids).toEqual([6]);
    expect(memory.other.pids).toEqual([7]);
  });

  it("reads a working set from ps and tasklist output", () => {
    expect(parseProcessWorkingSetKiB("darwin", "  184320\n")).toBe(184_320);
    expect(parseProcessWorkingSetKiB("linux", "")).toBeNull();
    expect(
      parseProcessWorkingSetKiB("win32", '"electron.exe","4321","Console","1","184,320 K"\r\n'),
    ).toBe(184_320);
    expect(
      parseProcessWorkingSetKiB("win32", '"electron.exe","4321","Console","1","184.320 K"'),
    ).toBe(184_320);
    expect(
      parseProcessWorkingSetKiB(
        "win32",
        "INFO: No tasks are running which match the specified criteria.",
      ),
    ).toBeNull();
  });
});
