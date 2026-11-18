/**
 * ProviderReplayRecorder - captures each provider thread's canonical event
 * stream, with the adapter calls that drove it and their timing, as a raw
 * replay recording under `<logs>/provider-recordings/`.
 *
 * Off unless `E6CODE_RECORD_PROVIDER_EVENTS` is set; when off, the adapter
 * registry hands out adapters unwrapped. When on, each adapter is wrapped
 * once. The wrapper taps the one event subscription ProviderService already
 * holds, because Codex, Claude and OpenCode stream through a single-consumer
 * queue and a second reader would steal events. Calls are placed between
 * events by the adapter's sequence watermark at call time, not by arrival.
 *
 * Raw recordings hold real paths and text. They are scrubbed with
 * `scripts/provider-replay.ts scrub` before anything is committed.
 *
 * @module provider/replay/ProviderReplayRecorder
 */
import type { ProviderRuntimeEvent, ThreadId } from "@e6tools/contracts";
import { RECORDING_FORMAT, RECORDING_VERSION } from "@e6tools/shared/testing/providerReplay/format";
import { withLegacyBrandEnv } from "@e6tools/shared/brand";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { toSafeThreadAttachmentSegment } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";

type Adapter = ProviderAdapterShape<ProviderAdapterError>;

interface Entry {
  /** Event sequence, or the call's watermark plus a half for steps. */
  readonly position: number;
  readonly order: number;
  readonly at: number;
  readonly line: Record<string, unknown>;
}

interface ThreadRecording {
  readonly provider: string;
  readonly threadId: ThreadId;
  readonly filePath: string;
  readonly entries: Array<Entry>;
  dirty: boolean;
}

export interface ProviderReplayRecorderShape {
  /** Returns the recording wrapper for an adapter; the same wrapper on every call. */
  readonly wrap: (adapter: Adapter) => Adapter;
  /** Writes every recording that changed since the last write. */
  readonly flush: Effect.Effect<void>;
  readonly directory: string;
}

export class ProviderReplayRecorder extends Context.Service<
  ProviderReplayRecorder,
  ProviderReplayRecorderShape
>()("e6/provider/replay/ProviderReplayRecorder") {}

const DROPPED_EVENT_FIELDS = ["raw", "providerRefs", "providerInstanceId"] as const;
const FLUSH_INTERVAL_MS = 1_000;

function eventLine(event: ProviderRuntimeEvent): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...event };
  for (const field of DROPPED_EVENT_FIELDS) delete copy[field];
  return copy;
}

function encode(recording: ThreadRecording): string {
  const entries = recording.entries.toSorted(
    (left, right) => left.position - right.position || left.order - right.order,
  );
  const header = {
    kind: "header",
    format: RECORDING_FORMAT,
    version: RECORDING_VERSION,
    id: `${recording.provider}.recorded`,
    provider: recording.provider,
    scenarios: [],
    source: "recorded",
  };
  const rows = [JSON.stringify(header)];
  let previousAt = entries[0]?.at ?? 0;
  for (const entry of entries) {
    const dt = Math.max(0, entry.at - previousAt);
    previousAt = Math.max(previousAt, entry.at);
    const { kind, ...rest } = entry.line;
    rows.push(JSON.stringify({ kind, dt, ...rest }));
  }
  return `${rows.join("\n")}\n`;
}

/** Builds a recorder writing to `directory`; flushes every second and on scope close. */
export const make = Effect.fn("ProviderReplayRecorder.make")(function* (directory: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const recordings = new Map<ThreadId, ThreadRecording>();
  // Recordings of sessions a restart replaced, kept until their last write.
  let retired: Array<ThreadRecording> = [];
  const wrappers = new WeakMap<Adapter, Adapter>();
  const writes = yield* Semaphore.make(1);
  let order = 0;
  let fileCount = 0;

  const flush = Effect.gen(function* () {
    const dirty = [...retired, ...recordings.values()].filter((recording) => recording.dirty);
    retired = retired.filter((recording) => recording.dirty);
    if (dirty.length === 0) return;
    yield* fileSystem.makeDirectory(directory, { recursive: true });
    for (const recording of dirty) {
      recording.dirty = false;
      yield* fileSystem.writeFileString(recording.filePath, encode(recording));
    }
    retired = retired.filter((recording) => recording.dirty);
  }).pipe(
    writes.withPermits(1),
    Effect.catch((error) => Effect.logWarning("provider replay recording write failed", { error })),
  );

  yield* Effect.forever(Effect.sleep(FLUSH_INTERVAL_MS).pipe(Effect.andThen(flush))).pipe(
    Effect.forkScoped,
  );
  yield* Effect.addFinalizer(() => flush);

  const append = (
    threadId: ThreadId,
    position: number,
    at: number,
    line: Record<string, unknown>,
  ) => {
    const recording = recordings.get(threadId);
    if (recording === undefined) return;
    order += 1;
    recording.entries.push({ position, order, at, line });
    recording.dirty = true;
  };

  /** Records a call as a step placed after every event published before it. */
  const recordStep = <A, E>(
    adapter: Adapter,
    threadId: ThreadId,
    call: Effect.Effect<A, E>,
    line: (result: A) => Record<string, unknown>,
  ) =>
    Effect.gen(function* () {
      const watermark = yield* adapter.runtimeEventSequence;
      const at = yield* Clock.currentTimeMillis;
      const result = yield* call;
      append(threadId, watermark + 0.5, at, { kind: "step", ...line(result) });
      return result;
    });

  const wrap = (adapter: Adapter): Adapter => {
    const existing = wrappers.get(adapter);
    if (existing) return existing;
    const provider = adapter.provider;

    const startSession: Adapter["startSession"] = (input) =>
      Effect.gen(function* () {
        const startedAt = DateTime.formatIso(yield* DateTime.now);
        const segment = toSafeThreadAttachmentSegment(input.threadId) ?? "thread";
        // Registered before the call so events published while it runs are
        // kept. A session this replaces keeps its own file.
        const previous = recordings.get(input.threadId);
        if (previous) retired.push(previous);
        fileCount += 1;
        recordings.set(input.threadId, {
          provider,
          threadId: input.threadId,
          filePath: path.join(
            directory,
            `${provider}.${segment}.${startedAt.replace(/[:.]/g, "-")}.${fileCount}.ndjson`,
          ),
          entries: [],
          dirty: false,
        });
        return yield* recordStep(adapter, input.threadId, adapter.startSession(input), () => ({
          on: "startSession",
        })).pipe(
          Effect.onError(() =>
            Effect.sync(() => {
              if (previous) {
                recordings.set(input.threadId, previous);
                retired = retired.filter((recording) => recording !== previous);
              } else {
                recordings.delete(input.threadId);
              }
            }),
          ),
        );
      });

    const wrapped: Adapter = {
      provider,
      capabilities: adapter.capabilities,
      runtimeEventSequence: adapter.runtimeEventSequence,
      subscribeRuntimeEvents: Effect.map(adapter.subscribeRuntimeEvents, (subscription) => ({
        sequence: subscription.sequence,
        events: subscription.events.pipe(
          Stream.tap(({ sequence, event }) =>
            Effect.map(Clock.currentTimeMillis, (at) =>
              append(event.threadId, sequence, at, { kind: "event", event: eventLine(event) }),
            ),
          ),
        ),
      })),
      startSession,
      sendTurn: (input) =>
        recordStep(adapter, input.threadId, adapter.sendTurn(input), (result) => ({
          on: "sendTurn",
          turnId: result.turnId,
          ...(input.input !== undefined ? { input: input.input } : {}),
          ...(input.interactionMode !== undefined
            ? { interactionMode: input.interactionMode }
            : {}),
        })),
      respondToRequest: (threadId, requestId, decision, feedback) =>
        recordStep(
          adapter,
          threadId,
          adapter.respondToRequest(threadId, requestId, decision, feedback),
          () => ({
            on: "respondToRequest",
            requestId,
            decision,
            ...(feedback !== undefined ? { feedback } : {}),
          }),
        ),
      respondToUserInput: (threadId, requestId, answers) =>
        recordStep(
          adapter,
          threadId,
          adapter.respondToUserInput(threadId, requestId, answers),
          () => ({ on: "respondToUserInput", requestId, answers }),
        ),
      interruptTurn: (threadId, turnId) =>
        recordStep(adapter, threadId, adapter.interruptTurn(threadId, turnId), () => ({
          on: "interruptTurn",
        })),
      // A stopped session is written at once rather than at the next tick.
      stopSession: (threadId) =>
        recordStep(adapter, threadId, adapter.stopSession(threadId), () => ({
          on: "stopSession",
        })).pipe(Effect.tap(() => flush)),
      listSessions: adapter.listSessions,
      hasSession: adapter.hasSession,
      readThread: adapter.readThread,
      rollbackThread: adapter.rollbackThread,
      stopAll: adapter.stopAll,
      get streamEvents() {
        return adapter.streamEvents;
      },
      // Optional members change ProviderService behaviour, so keep exactly the original's set.
      ...(adapter.compaction !== undefined ? { compaction: adapter.compaction } : {}),
      ...(adapter.stopSubagent !== undefined ? { stopSubagent: adapter.stopSubagent } : {}),
      ...(adapter.uploadFeedback !== undefined ? { uploadFeedback: adapter.uploadFeedback } : {}),
    };
    wrappers.set(adapter, wrapped);
    return wrapped;
  };

  return ProviderReplayRecorder.of({ wrap, flush, directory });
});

/** Provides the recorder only when `E6CODE_RECORD_PROVIDER_EVENTS` is set. */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const enabled = yield* withLegacyBrandEnv("RECORD_PROVIDER_EVENTS", Config.Boolean).pipe(
      Config.withDefault(false),
    );
    if (!enabled) return Layer.empty;
    const { logsDir } = yield* ServerConfig;
    const path = yield* Path.Path;
    const directory = path.join(logsDir, "provider-recordings");
    yield* Effect.logInfo("recording provider event streams", { directory });
    return Layer.effect(ProviderReplayRecorder, make(directory));
  }),
);
