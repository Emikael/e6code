import { describe, expect, it } from "vite-plus/test";

import type { HistogramPoint, OtlpExport } from "../otlpSink.ts";
import { commandAckRow, keystrokeRow, TURN_BOUNDARY_FLAG, wireBytesRow } from "./streamingRows.ts";

const keystrokes = {
  eventTimingObserved: true,
  keydownsMs: [],
  keysTyped: 40,
  thresholdMs: 16,
  keysAfterTurnEndAtMost: 5,
  turnBoundaryHeld: true,
};

describe("keystrokeRow", () => {
  it("reads unreported keys as under the threshold once Event Timing has reported", () => {
    expect(keystrokeRow(keystrokes)).toMatchObject({
      kind: "measured",
      statistic: "p95AtMost",
      value: 16,
      samples: 40,
      flags: ["eventTimingThreshold:16ms", "keydownsReported:0", "keysAfterTurnEndAtMost:5"],
    });
    // The 38th of 40 keys: 37 unreported, then 20.
    expect(keystrokeRow({ ...keystrokes, keydownsMs: [20, 24, 30] })).toMatchObject({
      kind: "measured",
      statistic: "p95",
      value: 20,
    });
  });

  it("measures nothing when Event Timing reported no entry on the page", () => {
    const row = keystrokeRow({ ...keystrokes, eventTimingObserved: false });
    expect(row).toMatchObject({ kind: "notMeasured", id: "web.input.keystrokeToPaint.p95" });
    expect(row.kind === "notMeasured" && row.reason).toContain("Event Timing");
  });

  it("measures nothing when no key was typed", () => {
    expect(keystrokeRow({ ...keystrokes, keysTyped: 0 })).toMatchObject({
      kind: "notMeasured",
      reason: "no keys typed",
    });
  });

  it("flags the row when the session did not confirm the turn boundaries", () => {
    expect(keystrokeRow(keystrokes).flags).not.toContain(TURN_BOUNDARY_FLAG);
    expect(keystrokeRow({ ...keystrokes, turnBoundaryHeld: false }).flags).toContain(
      TURN_BOUNDARY_FLAG,
    );
  });
});

const BOUNDS = [0.5, 1, 2, 4, 8, 16, 32];
const point = (timeUnixMs: number, counts: ReadonlyArray<number>): HistogramPoint => ({
  series: "commandType=thread.turn.start",
  timeUnixMs,
  bounds: BOUNDS,
  counts,
});
const otlpExport = (timeUnixMs: number, ack: ReadonlyArray<HistogramPoint>): OtlpExport => ({
  receivedAtMs: timeUnixMs,
  timeUnixMs,
  ack,
});

describe("commandAckRow", () => {
  const window = { windowStartMs: 10_000, windowEndMs: 40_000, waitMs: 10_000, otlpEnabled: true };
  // Twenty commands before the window, mostly slow boot and seed work in the 16-32 ms bucket.
  const before = otlpExport(9_000, [point(9_000, [0, 0, 0, 0, 0, 0, 20, 0])]);
  // Ten more inside the window, all in 1-2 ms.
  const after = otlpExport(41_000, [point(41_000, [0, 0, 10, 0, 0, 0, 20, 0])]);

  it("counts only the commands between the exports either side of the window", () => {
    expect(commandAckRow({ ...window, before, after }).metric).toMatchObject({
      kind: "measured",
      statistic: "p95AtMost",
      value: 2,
      samples: 10,
      flags: ["bucketResolution:1-2ms", "windowEdgeSlackMs:1000+1000"],
    });
  });

  it("counts from zero after an export that held no acknowledgement yet", () => {
    const empty = otlpExport(9_000, []);
    const firstAcks = otlpExport(41_000, [point(41_000, [0, 0, 10, 0, 0, 0, 0, 0])]);
    expect(commandAckRow({ ...window, before: empty, after: firstAcks }).metric).toMatchObject({
      kind: "measured",
      value: 2,
      samples: 10,
    });
  });

  it("measures nothing without an export before the window, rather than a delta since server start", () => {
    const { metric } = commandAckRow({ ...window, before: null, after });
    expect(metric).toMatchObject({ kind: "notMeasured", id: "server.commandAck.p95" });
    expect(metric.kind === "notMeasured" && metric.reason).toContain("before the window");
  });

  it("measures nothing without an export after the window or with OTLP off", () => {
    expect(commandAckRow({ ...window, before, after: null }).metric.kind).toBe("notMeasured");
    expect(commandAckRow({ ...window, otlpEnabled: false, before, after }).metric.kind).toBe(
      "notMeasured",
    );
  });
});

describe("wireBytesRow", () => {
  const wire = {
    wsConnections: 1,
    serverToClientBytes: 30_000,
    windowSeconds: 10,
    turnBoundaryHeld: true,
  };

  it("divides the /ws bytes by the window", () => {
    expect(wireBytesRow(wire)).toMatchObject({ kind: "measured", value: 3_000 });
  });

  it("measures nothing when the proxy classified no /ws connection", () => {
    const row = wireBytesRow({ ...wire, wsConnections: 0, serverToClientBytes: 0 });
    expect(row).toMatchObject({ kind: "notMeasured", id: "ws.streaming.wireBytesPerSecond" });
    expect(row.kind === "notMeasured" && row.reason).toContain("/ws");
  });

  it("flags the row when the session did not confirm the turn boundaries", () => {
    expect(wireBytesRow(wire).flags ?? []).not.toContain(TURN_BOUNDARY_FLAG);
    expect(wireBytesRow({ ...wire, turnBoundaryHeld: false }).flags).toContain(TURN_BOUNDARY_FLAG);
  });
});
