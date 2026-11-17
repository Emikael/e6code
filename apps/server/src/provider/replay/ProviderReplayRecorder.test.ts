import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderDriverKind, type ProviderRuntimeEvent, ThreadId } from "@e6tools/contracts";
import { listCorpusFiles, readCorpusFile } from "@e6tools/shared/testing/providerReplay/corpus";
import {
  decodeRecording,
  type ProviderReplayRecording,
  type RecordingLine,
} from "@e6tools/shared/testing/providerReplay/recording";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { contractRecording } from "../testUtils/replayRecordings.ts";
import * as ProviderReplayRecorder from "./ProviderReplayRecorder.ts";
import { makeReplayProviderAdapter } from "./ReplayProviderAdapter.ts";

const recordedId = (id: string | undefined) => id?.replace(/^rp-[a-z0-9]+\.\d+\.\d+:/, "");

/** Everything a round trip must preserve: order, timing, calls and event content. */
function comparableLine(line: RecordingLine) {
  if (line.kind === "step") {
    const { kind, dt, on, ...rest } = line;
    const fields = rest as Record<string, unknown>;
    if (typeof fields.turnId === "string") fields.turnId = recordedId(fields.turnId);
    if (typeof fields.requestId === "string") fields.requestId = recordedId(fields.requestId);
    return { kind, dt, on, ...fields };
  }
  const event = line.event;
  const payload = { ...(event.payload as Record<string, unknown>) };
  for (const field of ["taskId", "agentId", "parentAgentId", "toolUseId", "parentToolUseId"]) {
    if (typeof payload[field] === "string") payload[field] = recordedId(payload[field] as string);
  }
  return {
    kind: line.kind,
    dt: line.dt,
    type: event.type,
    eventId: recordedId(event.eventId),
    turnId: recordedId(event.turnId),
    itemId: recordedId(event.itemId),
    requestId: recordedId(event.requestId),
    payload,
  };
}

/** Drives a wrapped replay of `recording` with every call at its recorded time. */
const recordReplay = Effect.fnUntraced(function* (recording: ProviderReplayRecording) {
  const fileSystem = yield* FileSystem.FileSystem;
  const directory = yield* fileSystem.makeTempDirectoryScoped();
  const recorder = yield* ProviderReplayRecorder.make(directory);
  const replay = yield* makeReplayProviderAdapter({ recording, speed: 1 });
  const adapter = recorder.wrap(replay);

  const subscription = yield* adapter.subscribeRuntimeEvents;
  const delivered = yield* Queue.unbounded<ProviderRuntimeEvent>();
  yield* subscription.events.pipe(
    Stream.runForEach(({ event }) => Queue.offer(delivered, event)),
    Effect.forkScoped,
  );

  const threadId = ThreadId.make("recorded-thread");
  // Replay ids carry the adapter's namespace; the first turn id reveals it.
  let namespace = "";
  const remap = (id: string) => `${namespace}:${id}` as never;
  let elapsed = 0;
  let now = 0;
  for (const line of recording.lines) {
    elapsed += line.dt;
    if (elapsed > now) {
      yield* TestClock.adjust(elapsed - now);
      now = elapsed;
    }
    if (line.kind !== "step") continue;
    switch (line.on) {
      case "startSession":
        yield* adapter.startSession({
          threadId,
          provider: adapter.provider,
          runtimeMode: "approval-required",
        });
        break;
      case "sendTurn": {
        const turn = yield* adapter.sendTurn({
          threadId,
          ...(line.input !== undefined ? { input: line.input } : {}),
          ...(line.interactionMode !== undefined ? { interactionMode: line.interactionMode } : {}),
        });
        namespace = turn.turnId.slice(0, turn.turnId.indexOf(":"));
        break;
      }
      case "respondToRequest":
        yield* adapter.respondToRequest(
          threadId,
          remap(line.requestId),
          line.decision,
          line.feedback,
        );
        break;
      case "respondToUserInput":
        yield* adapter.respondToUserInput(threadId, remap(line.requestId), line.answers);
        break;
      case "interruptTurn":
        yield* adapter.interruptTurn(threadId);
        break;
      case "stopSession":
        yield* adapter.stopSession(threadId);
        break;
    }
  }
  const eventCount = recording.lines.filter((line) => line.kind === "event").length;
  yield* Effect.forEach(Array.from({ length: eventCount }), () => Queue.take(delivered));
  yield* recorder.flush;

  const files = yield* fileSystem.readDirectory(directory);
  expect(files).toHaveLength(1);
  const text = yield* fileSystem.readFileString(`${directory}/${files[0]}`);
  return yield* decodeRecording(text);
});

describe("ProviderReplayRecorder", () => {
  for (const file of listCorpusFiles()) {
    it.effect(`records a replay of ${file.kind}s/${file.name} back to the original`, () =>
      Effect.gen(function* () {
        const original = yield* decodeRecording(readCorpusFile(file));

        const recorded = yield* recordReplay(original);

        expect(recorded.header).toMatchObject({
          provider: original.header.provider,
          source: "recorded",
        });
        expect(recorded.lines.map(comparableLine)).toEqual(original.lines.map(comparableLine));
      }).pipe(Effect.provide(NodeServices.layer)),
    );
  }

  it.effect("keeps each session's recording when a thread restarts before a flush", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const directory = yield* fileSystem.makeTempDirectoryScoped();
      const recorder = yield* ProviderReplayRecorder.make(directory);
      const codex = ProviderDriverKind.make("codex");
      const adapter = recorder.wrap(
        yield* makeReplayProviderAdapter({
          recording: contractRecording(codex, "plain"),
          speed: "instant",
        }),
      );
      const threadId = ThreadId.make("restarted-thread");

      const stepsOnDisk = Effect.gen(function* () {
        const files = [...(yield* fileSystem.readDirectory(directory))].sort();
        return yield* Effect.forEach(files, (name) =>
          Effect.map(
            Effect.flatMap(fileSystem.readFileString(`${directory}/${name}`), decodeRecording),
            (recording) =>
              recording.lines.flatMap((line) => (line.kind === "step" ? [line.on] : [])),
          ),
        );
      });

      // The clock never moves, so no timed write happens during this test.
      yield* adapter.startSession({ threadId, provider: codex, runtimeMode: "full-access" });
      yield* adapter.sendTurn({ threadId, input: "First." });
      yield* adapter.startSession({ threadId, provider: codex, runtimeMode: "full-access" });
      yield* recorder.flush;
      expect(yield* stepsOnDisk).toEqual([["startSession", "sendTurn"], ["startSession"]]);

      // Stopping writes the session straight away.
      yield* adapter.stopSession(threadId);
      expect(yield* stepsOnDisk).toEqual([
        ["startSession", "sendTurn"],
        ["startSession", "stopSession"],
      ]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("wraps each adapter once and keeps exactly its optional members", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const recorder = yield* ProviderReplayRecorder.make(
        yield* fileSystem.makeTempDirectoryScoped(),
      );
      const codex = ProviderDriverKind.make("codex");
      const plain = yield* makeReplayProviderAdapter({
        recording: contractRecording(codex, "plain"),
      });
      const withOptional: ProviderAdapterShape<ProviderAdapterError> = {
        ...plain,
        stopSubagent: () => Effect.void,
        compaction: { type: "slash-command", command: "/compact" },
      };

      expect(recorder.wrap(plain)).toBe(recorder.wrap(plain));
      expect(recorder.wrap(plain)).not.toBe(plain);
      expect(Object.keys(recorder.wrap(plain)).toSorted()).toEqual(Object.keys(plain).toSorted());
      const wrapped = recorder.wrap(withOptional);
      expect(wrapped.stopSubagent).toBe(withOptional.stopSubagent);
      expect(wrapped.compaction).toBe(withOptional.compaction);
      expect("uploadFeedback" in wrapped).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
