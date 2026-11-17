import { assert, describe, it } from "vite-plus/test";

import { REQUIRED_STARTUP_PHASES as SOURCE_REQUIRED_PHASES } from "../src/app/DesktopStartupClock.ts";
import { REQUIRED_STARTUP_PHASES, validateStartupRecordLog } from "./startup-record.mjs";

const bucket = { count: 1, workingSetBytes: 1024, peakWorkingSetBytes: 2048, pids: [1] };
const record = (overrides = {}) => ({
  type: "desktop-startup",
  version: 1,
  runId: "run",
  outcome: "settled",
  phases: Object.fromEntries(
    REQUIRED_STARTUP_PHASES.map((phase) => [phase, { status: "reached", atMs: 10 }]),
  ),
  ...overrides,
});
const memory = (overrides = {}) => ({
  type: "desktop-startup-memory",
  version: 1,
  runId: "run",
  label: "10s",
  processes: {
    main: bucket,
    rendererMain: bucket,
    rendererOther: bucket,
    gpu: bucket,
    utility: bucket,
    other: bucket,
    serverChild: { status: "sampled", pid: 2, workingSetBytes: 4096 },
  },
  ...overrides,
});
const log = (...entries) => entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";

describe("validateStartupRecordLog", () => {
  it("checks the same required phases the desktop records", () => {
    assert.deepStrictEqual(REQUIRED_STARTUP_PHASES, [...SOURCE_REQUIRED_PHASES]);
  });

  it("accepts one complete record with its 10 s memory sample", () => {
    assert.deepStrictEqual(validateStartupRecordLog(log(record(), memory())), []);
  });

  it("accepts phases that are not applicable or were not reached", () => {
    const phases = record().phases;
    phases.shellInteractive = { status: "not-applicable", reason: "landing:welcome" };
    phases.backendReady = { status: "not-reached", reason: "deadline" };
    assert.deepStrictEqual(validateStartupRecordLog(log(record({ phases }), memory())), []);
  });

  it("rejects a log without a record", () => {
    assert.deepStrictEqual(validateStartupRecordLog(log(memory())), [
      "expected one desktop-startup record, found 0",
    ]);
    assert.deepStrictEqual(validateStartupRecordLog(""), [
      "expected one desktop-startup record, found 0",
    ]);
  });

  it("rejects two records for one launch", () => {
    assert.deepStrictEqual(validateStartupRecordLog(log(record(), record(), memory())), [
      "expected one desktop-startup record, found 2",
    ]);
  });

  it("rejects a record missing a phase or of another version", () => {
    const phases = { ...record().phases };
    delete phases.rendererFirstPaint;
    assert.deepStrictEqual(
      validateStartupRecordLog(log(record({ phases, version: 2 }), memory())),
      [
        "unsupported record version 2",
        "phase rendererFirstPaint is missing or has no valid status",
      ],
    );
  });

  it("rejects a log whose memory sample is missing or incomplete", () => {
    assert.deepStrictEqual(validateStartupRecordLog(log(record(), memory({ label: "60s" }))), [
      "no 10s memory sample for run run",
    ]);
    assert.deepStrictEqual(validateStartupRecordLog(log(record(), memory({ runId: "other" }))), [
      "no 10s memory sample for run run",
    ]);
    const { serverChild: _serverChild, ...processes } = memory().processes;
    assert.deepStrictEqual(validateStartupRecordLog(log(record(), memory({ processes }))), [
      "memory sample has no serverChild entry",
    ]);
  });
});
