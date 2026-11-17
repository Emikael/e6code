/**
 * Provider replay recordings: canonical `ProviderRuntimeEvent` streams with
 * timing, stored as NDJSON so server tests, the client harness and demos can
 * replay real provider behaviour without spending provider credits.
 *
 * A recording is a header line followed by step and event lines in the order
 * they happened. A step is an adapter call (start, turn, approval answer, ...)
 * and the events after it are what the provider emitted until the next call.
 * Every line's `dt` is milliseconds since the previous line, so a replay at
 * 1x reproduces both order and timing.
 *
 * @module testing/providerReplay/recording
 */
import {
  ProviderApprovalDecision,
  ProviderDriverKind,
  ProviderInteractionMode,
  ProviderRuntimeEvent,
  ProviderUserInputAnswers,
} from "@e6tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { RECORDING_FORMAT, RECORDING_VERSION } from "./format.ts";

export const ReplayScenario = Schema.Literals([
  "tool-heavy",
  "streaming-prose",
  "subagent-fleet",
  "approval-flow",
  "user-input",
  "plan-mode",
  "interrupt",
]);
export type ReplayScenario = typeof ReplayScenario.Type;

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));
const Delay = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

export const RecordingHeader = Schema.Struct({
  kind: Schema.Literal("header"),
  format: Schema.Literal(RECORDING_FORMAT),
  version: Schema.Literal(RECORDING_VERSION),
  id: NonEmptyString,
  provider: ProviderDriverKind,
  scenarios: Schema.Array(ReplayScenario),
  /** "hand-made" fixtures are written for tests; "recorded" ones come from real sessions. */
  source: Schema.Literals(["hand-made", "recorded"]),
  /** Set by the scrubber; committed recordings must carry the current version. */
  scrubVersion: Schema.optional(Schema.Int),
  capturedWith: Schema.optional(
    Schema.Struct({
      e6Version: Schema.optional(NonEmptyString),
      providerVersion: Schema.optional(NonEmptyString),
      model: Schema.optional(NonEmptyString),
    }),
  ),
});
export type RecordingHeader = typeof RecordingHeader.Type;

export const StartSessionStep = Schema.Struct({
  kind: Schema.Literal("step"),
  dt: Delay,
  on: Schema.Literal("startSession"),
});

export const SendTurnStep = Schema.Struct({
  kind: Schema.Literal("step"),
  dt: Delay,
  on: Schema.Literal("sendTurn"),
  /** The turn id the adapter returned; the turn's events carry it. */
  turnId: NonEmptyString,
  input: Schema.optional(Schema.String),
  interactionMode: Schema.optional(ProviderInteractionMode),
});

export const RespondToRequestStep = Schema.Struct({
  kind: Schema.Literal("step"),
  dt: Delay,
  on: Schema.Literal("respondToRequest"),
  requestId: NonEmptyString,
  decision: ProviderApprovalDecision,
  feedback: Schema.optional(Schema.String),
});

export const RespondToUserInputStep = Schema.Struct({
  kind: Schema.Literal("step"),
  dt: Delay,
  on: Schema.Literal("respondToUserInput"),
  requestId: NonEmptyString,
  answers: ProviderUserInputAnswers,
});

export const InterruptTurnStep = Schema.Struct({
  kind: Schema.Literal("step"),
  dt: Delay,
  on: Schema.Literal("interruptTurn"),
});

export const StopSessionStep = Schema.Struct({
  kind: Schema.Literal("step"),
  dt: Delay,
  on: Schema.Literal("stopSession"),
});

export const RecordingStep = Schema.Union([
  StartSessionStep,
  SendTurnStep,
  RespondToRequestStep,
  RespondToUserInputStep,
  InterruptTurnStep,
  StopSessionStep,
]);
export type RecordingStep = typeof RecordingStep.Type;

export const RecordingEvent = Schema.Struct({
  kind: Schema.Literal("event"),
  dt: Delay,
  event: ProviderRuntimeEvent,
});
export type RecordingEvent = typeof RecordingEvent.Type;

export const RecordingLine = Schema.Union([RecordingStep, RecordingEvent]);
export type RecordingLine = typeof RecordingLine.Type;

export interface ProviderReplayRecording {
  readonly header: RecordingHeader;
  readonly lines: ReadonlyArray<RecordingLine>;
}

export class RecordingDecodeError extends Schema.TaggedError<RecordingDecodeError>()(
  "RecordingDecodeError",
  {
    line: Schema.Int,
    issue: Schema.String,
  },
) {
  override get message(): string {
    return `Invalid provider replay recording at line ${this.line}: ${this.issue}`;
  }
}

const decodeHeaderLine = Schema.decodeUnknownEffect(Schema.fromJsonString(RecordingHeader));
const decodeBodyLine = Schema.decodeUnknownEffect(Schema.fromJsonString(RecordingLine));
const encodeHeaderLine = Schema.encodeSync(Schema.fromJsonString(RecordingHeader));
const encodeBodyLine = Schema.encodeSync(Schema.fromJsonString(RecordingLine));

/** Decodes NDJSON text into a recording, validating every event against the contract. */
export const decodeRecording = Effect.fnUntraced(function* (text: string) {
  const rows = text.split("\n").filter((row) => row.trim().length > 0);
  if (rows.length === 0) {
    return yield* new RecordingDecodeError({ line: 1, issue: "empty recording" });
  }
  const header = yield* decodeHeaderLine(rows[0]).pipe(
    Effect.mapError((error) => new RecordingDecodeError({ line: 1, issue: error.message })),
  );
  const lines: Array<RecordingLine> = [];
  for (let index = 1; index < rows.length; index += 1) {
    const line = yield* decodeBodyLine(rows[index]).pipe(
      Effect.mapError(
        (error) => new RecordingDecodeError({ line: index + 1, issue: error.message }),
      ),
    );
    if (line.kind === "event" && line.event.provider !== header.provider) {
      return yield* new RecordingDecodeError({
        line: index + 1,
        issue: `event provider '${line.event.provider}' does not match header provider '${header.provider}'`,
      });
    }
    lines.push(line);
  }
  return { header, lines } satisfies ProviderReplayRecording;
});

/** Encodes a recording as NDJSON, one line per header, step and event. */
export function encodeRecording(recording: ProviderReplayRecording): string {
  const rows = [encodeHeaderLine(recording.header)];
  for (const line of recording.lines) {
    rows.push(encodeBodyLine(line));
  }
  return `${rows.join("\n")}\n`;
}

/** Counts events per canonical type; used by tests and the `stats` command. */
export function countEventTypes(recording: ProviderReplayRecording): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const line of recording.lines) {
    if (line.kind !== "event") continue;
    counts.set(line.event.type, (counts.get(line.event.type) ?? 0) + 1);
  }
  return counts;
}

/** Total recorded duration in milliseconds. */
export function recordingDurationMs(recording: ProviderReplayRecording): number {
  return recording.lines.reduce((total, line) => total + line.dt, 0);
}
