/**
 * The streaming-input rows whose source can come back empty (plan §4.3):
 * keystroke to paint, command acknowledgement and wire bytes per second. A
 * source that saw nothing makes its row `notMeasured`, so an empty source never
 * reads as a fast one.
 *
 * @module perf-harness/scenarios/streamingRows
 */
import { ackWindow, COMMAND_ACK_METRIC, type OtlpExport } from "../otlpSink.ts";
import type { MetricOutcome } from "../report.ts";
import { p95WithUnreported } from "../stats.ts";

/** On the rows the Stop button bounds, when the thread's session did not confirm those bounds. */
export const TURN_BOUNDARY_FLAG = "turnBoundaryUnconfirmed";

/** `web.input.keystrokeToPaint.p95` from the keydown Event Timing entries inside the window. */
export function keystrokeRow(input: {
  readonly eventTimingObserved: boolean;
  readonly keydownsMs: ReadonlyArray<number>;
  readonly keysTyped: number;
  readonly thresholdMs: number;
  readonly keysAfterTurnEndAtMost: number;
  readonly turnBoundaryHeld: boolean;
}): MetricOutcome {
  const boundaryFlags = input.turnBoundaryHeld ? [] : [TURN_BOUNDARY_FLAG];
  // Unreported keys count as under the threshold only when Event Timing is known to report.
  if (!input.eventTimingObserved) {
    return {
      kind: "notMeasured",
      id: "web.input.keystrokeToPaint.p95",
      reason:
        "Event Timing reported no entry on the page (no first-input), so keys it did not report cannot be read as under the threshold",
      flags: boundaryFlags,
    };
  }
  const keystroke = p95WithUnreported({
    reported: input.keydownsMs,
    total: input.keysTyped,
    thresholdMs: input.thresholdMs,
  });
  if (keystroke === null) {
    return {
      kind: "notMeasured",
      id: "web.input.keystrokeToPaint.p95",
      reason: "no keys typed",
      flags: boundaryFlags,
    };
  }
  return {
    kind: "measured",
    id: "web.input.keystrokeToPaint.p95",
    unit: "ms",
    statistic: keystroke.atMost ? "p95AtMost" : "p95",
    value: keystroke.value,
    samples: keystroke.samples,
    source:
      "event-timing:keydown duration over keys typed while a turn streamed; unreported keys count as under the threshold",
    flags: [
      `eventTimingThreshold:${input.thresholdMs}ms`,
      `keydownsReported:${input.keydownsMs.length}`,
      // Stop is checked every few keys, so only a bound is known.
      `keysAfterTurnEndAtMost:${input.keysAfterTurnEndAtMost}`,
      ...boundaryFlags,
    ],
  };
}

type AckWindow = ReturnType<typeof ackWindow>;

/** `server.commandAck.p95` from the OTLP exports either side of the window. */
export function commandAckRow(input: {
  readonly otlpEnabled: boolean;
  readonly waitMs: number;
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly before: OtlpExport | null;
  readonly after: OtlpExport | null;
}): { readonly metric: MetricOutcome; readonly ack: AckWindow | null } {
  const id = "server.commandAck.p95";
  if (!input.otlpEnabled) {
    return {
      metric: { kind: "notMeasured", id, reason: "--no-otlp: the server exported no metrics" },
      ack: null,
    };
  }
  // Exports are cumulative from server start: without one before the window, the delta would
  // count every command since boot, the seed's replay and pairing included.
  if (input.before === null) {
    return {
      metric: {
        kind: "notMeasured",
        id,
        reason:
          "no OTLP export arrived before the window, so its commands cannot be told from those since server start",
      },
      ack: null,
    };
  }
  if (input.after === null) {
    return {
      metric: {
        kind: "notMeasured",
        id,
        reason: `no OTLP export arrived within ${input.waitMs} ms after the window`,
      },
      ack: null,
    };
  }
  const ack = ackWindow({ before: input.before.ack, after: input.after.ack });
  if (ack.p95AtMost === null) {
    return {
      metric: {
        kind: "notMeasured",
        id,
        reason:
          ack.samples === 0
            ? "no command was acknowledged inside the window"
            : `the p95 fell in the overflow bucket (${ack.bucket})`,
      },
      ack,
    };
  }
  return {
    metric: {
      kind: "measured",
      id,
      unit: "ms",
      statistic: "p95AtMost",
      value: ack.p95AtMost,
      samples: ack.samples,
      source: `otlp:${COMMAND_ACK_METRIC} bucket delta between the exports either side of the stream window`,
      flags: [
        `bucketResolution:${ack.bucket}ms`,
        `windowEdgeSlackMs:${Math.round(input.windowStartMs - input.before.timeUnixMs)}+${Math.round(input.after.timeUnixMs - input.windowEndMs)}`,
      ],
    },
    ack,
  };
}

/** `ws.streaming.wireBytesPerSecond` from the proxy's server-to-client bytes on `GET /ws`. */
export function wireBytesRow(input: {
  readonly wsConnections: number;
  readonly serverToClientBytes: number;
  readonly windowSeconds: number;
  readonly turnBoundaryHeld: boolean;
}): MetricOutcome {
  const flags = input.turnBoundaryHeld ? [] : [TURN_BOUNDARY_FLAG];
  if (input.wsConnections === 0) {
    return {
      kind: "notMeasured",
      id: "ws.streaming.wireBytesPerSecond",
      reason: "the proxy classified no GET /ws connection, so it counted no WebSocket bytes",
      flags,
    };
  }
  return {
    kind: "measured",
    id: "ws.streaming.wireBytesPerSecond",
    unit: "bytesPerSecond",
    statistic: "value",
    value: input.serverToClientBytes / input.windowSeconds,
    samples: null,
    source:
      "tcp-proxy passthrough: server-to-client bytes on the /ws connection over the stream window",
    flags,
  };
}
