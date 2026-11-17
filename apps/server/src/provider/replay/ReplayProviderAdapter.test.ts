import { ProviderDriverKind, type ProviderRuntimeEvent, ThreadId } from "@e6tools/contracts";
import { listCorpusFiles, readCorpusFile } from "@e6tools/shared/testing/providerReplay/corpus";
import {
  decodeRecording,
  type ProviderReplayRecording,
  type RecordingLine,
} from "@e6tools/shared/testing/providerReplay/recording";
import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { runAdapterContract } from "../testUtils/adapterContract.ts";
import { contractRecording } from "../testUtils/replayRecordings.ts";
import {
  makeReplayProviderAdapter,
  type ReplayProviderAdapterOptions,
} from "./ReplayProviderAdapter.ts";
import { REPLAY_PROVIDERS, replayProfileFor } from "./replayProfiles.ts";

for (const provider of REPLAY_PROVIDERS) {
  const profile = replayProfileFor(provider);
  runAdapterContract({
    name: `ReplayProviderAdapter (${provider})`,
    provider,
    makeSubject: (scenario) =>
      Effect.map(
        makeReplayProviderAdapter({
          recording: contractRecording(provider, scenario),
          speed: "instant",
        }),
        (adapter) => ({ adapter }),
      ),
    validatesProviderMismatch: profile.validatesProviderMismatch,
    gates: true,
    nativeApprovalFeedback: profile.capabilities.approvalFeedback === "native",
  });
}

/** Subscribes once and buffers every event the adapter delivers, in order. */
const collect = Effect.fnUntraced(function* (adapter: ProviderAdapterShape<ProviderAdapterError>) {
  const subscription = yield* adapter.subscribeRuntimeEvents;
  const delivered = yield* Queue.unbounded<ProviderRuntimeEvent>();
  yield* subscription.events.pipe(
    Stream.runForEach(({ event }) => Queue.offer(delivered, event)),
    Effect.forkScoped,
  );
  const seen: Array<ProviderRuntimeEvent> = [];
  const takeOne = Effect.tap(Queue.take(delivered), (event) => Effect.sync(() => seen.push(event)));
  return {
    seen,
    /** Waits until `count` events have been delivered in total. */
    total: Effect.fnUntraced(function* (count: number) {
      while (seen.length < count) yield* takeOne;
      return seen.slice(0, count);
    }),
    /** Waits for the next event matching the predicate. */
    until: Effect.fnUntraced(function* (predicate: (event: ProviderRuntimeEvent) => boolean) {
      while (true) {
        const event = yield* takeOne;
        if (predicate(event)) return event;
      }
    }),
  };
});

const turnEnded = (turnId: string) => (event: ProviderRuntimeEvent) =>
  (event.type === "turn.completed" || event.type === "turn.aborted") && event.turnId === turnId;

/** Strips the replay's id namespace so emitted ids compare with recorded ones. */
const recordedId = (id: string | undefined) => id?.replace(/^rp-[a-z0-9]+\.\d+\.\d+:/, "");
/** The replay namespace of an id: adapter, session and loop. */
const namespaceOf = (id: string) => id.slice(0, id.indexOf(":"));

/** What must match between a recording and its replay: order, type, ids and payload. */
function comparable(event: ProviderRuntimeEvent) {
  const payload = { ...(event.payload as Record<string, unknown>) };
  for (const field of ["taskId", "agentId", "parentAgentId", "toolUseId", "parentToolUseId"]) {
    if (typeof payload[field] === "string") payload[field] = recordedId(payload[field] as string);
  }
  return {
    type: event.type,
    eventId: recordedId(event.eventId),
    turnId: recordedId(event.turnId),
    itemId: recordedId(event.itemId),
    requestId: recordedId(event.requestId),
    payload,
  };
}

function recordedEvents(recording: ProviderReplayRecording) {
  return recording.lines.flatMap((line) => (line.kind === "event" ? [line.event] : []));
}

/**
 * Plays a recording the way it was captured: each adapter call at its recorded
 * time, answers left to autoRespond, the clock advanced line by line.
 */
const playAtRecordedTimes = Effect.fnUntraced(function* (
  recording: ProviderReplayRecording,
  options: Omit<ReplayProviderAdapterOptions, "recording"> = {},
) {
  const adapter = yield* makeReplayProviderAdapter({ ...options, recording, autoRespond: true });
  const events = yield* collect(adapter);
  const threadId = ThreadId.make("replay-thread");
  const scale = typeof options.speed === "number" ? options.speed : 1;
  let elapsed = 0;
  let now = 0;
  for (const line of recording.lines) {
    elapsed += line.dt / scale;
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
      case "sendTurn":
        yield* adapter.sendTurn({
          threadId,
          input: line.input ?? "Continue.",
          ...(line.interactionMode !== undefined ? { interactionMode: line.interactionMode } : {}),
        });
        break;
      case "interruptTurn":
        yield* adapter.interruptTurn(threadId);
        break;
      case "stopSession":
        yield* adapter.stopSession(threadId);
        break;
      default:
        break;
    }
  }
  const emitted = yield* events.total(recordedEvents(recording).length);
  return { adapter, emitted };
});

const corpus = listCorpusFiles();

describe("ReplayProviderAdapter corpus replay", () => {
  for (const file of corpus) {
    it.effect(
      `replays ${file.kind}s/${file.name} at 1x with recorded order, counts and timing`,
      () =>
        Effect.gen(function* () {
          const recording = yield* decodeRecording(readCorpusFile(file));
          const start = yield* Clock.currentTimeMillis;
          const { adapter, emitted } = yield* playAtRecordedTimes(recording, { speed: 1 });

          const recorded = recordedEvents(recording);
          expect(emitted.map(comparable)).toEqual(recorded.map(comparable));
          // Nothing beyond the recording was published either.
          expect(yield* adapter.runtimeEventSequence).toBe(recorded.length);

          // Each event lands at its recorded offset from the first event.
          const recordedOffsets: Array<number> = [];
          let elapsed = 0;
          for (const line of recording.lines) {
            elapsed += line.dt;
            if (line.kind === "event") recordedOffsets.push(elapsed);
          }
          const emittedOffsets = emitted.map((event) => Date.parse(event.createdAt) - start);
          expect(emittedOffsets).toEqual(recordedOffsets);
        }),
    );

    it.effect(`replays ${file.kind}s/${file.name} at 4x in a quarter of the time`, () =>
      Effect.gen(function* () {
        const recording = yield* decodeRecording(readCorpusFile(file));
        const start = yield* Clock.currentTimeMillis;
        const { emitted } = yield* playAtRecordedTimes(recording, { speed: 4 });

        expect(emitted.map(comparable)).toEqual(recordedEvents(recording).map(comparable));
        const total = recording.lines.reduce((sum, line) => sum + line.dt, 0);
        const lastEventIndex = recording.lines.findLastIndex((line) => line.kind === "event");
        const lastOffset = recording.lines
          .slice(0, lastEventIndex + 1)
          .reduce((sum, line) => sum + line.dt, 0);
        // createdAt has millisecond precision; quarter delays can be fractional.
        expect(
          Math.abs(Date.parse(emitted.at(-1)!.createdAt) - start - lastOffset / 4),
        ).toBeLessThan(1);
        expect(lastOffset).toBeLessThanOrEqual(total);
      }),
    );

    it.effect(`replays ${file.kind}s/${file.name} instantly in recorded order`, () =>
      Effect.gen(function* () {
        const recording = yield* decodeRecording(readCorpusFile(file));
        const adapter = yield* makeReplayProviderAdapter({
          recording,
          speed: "instant",
          autoRespond: true,
        });
        const events = yield* collect(adapter);
        const threadId = ThreadId.make("instant-thread");
        const start = yield* Clock.currentTimeMillis;
        yield* adapter.startSession({
          threadId,
          provider: adapter.provider,
          runtimeMode: "full-access",
        });
        for (const line of recording.lines) {
          if (line.kind !== "step" || line.on !== "sendTurn") continue;
          const turn = yield* adapter.sendTurn({ threadId, input: "Continue." });
          expect(recordedId(turn.turnId)).toBe(line.turnId);
          yield* events.until(turnEnded(turn.turnId));
        }
        const emitted = yield* events.total(recordedEvents(recording).length);

        expect(emitted.map(comparable)).toEqual(recordedEvents(recording).map(comparable));
        expect(emitted.every((event) => Date.parse(event.createdAt) === start)).toBe(true);
      }),
    );
  }
});

describe("ReplayProviderAdapter ids", () => {
  const codex = ProviderDriverKind.make("codex");

  it.effect("gives each session its own ids while keeping references consistent", () =>
    Effect.gen(function* () {
      const adapter = yield* makeReplayProviderAdapter({
        recording: contractRecording(codex, "approval"),
        speed: "instant",
        autoRespond: true,
      });
      const events = yield* collect(adapter);
      for (const id of ["thread-a", "thread-b"]) {
        const threadId = ThreadId.make(id);
        yield* adapter.startSession({
          threadId,
          provider: codex,
          runtimeMode: "approval-required",
        });
        yield* adapter.sendTurn({ threadId, input: "Go." });
      }
      const emitted = yield* events.total(14);

      const byThread = (threadId: string) => emitted.filter((event) => event.threadId === threadId);
      const idsOf = (list: ReadonlyArray<ProviderRuntimeEvent>) =>
        new Set(
          list.flatMap((event) => [event.eventId, event.turnId, event.itemId, event.requestId]),
        );
      const a = idsOf(byThread("thread-a"));
      const b = idsOf(byThread("thread-b"));
      a.delete(undefined);
      expect([...a].filter((id) => b.has(id))).toEqual([]);
      for (const threadId of ["thread-a", "thread-b"]) {
        const opened = byThread(threadId).find((event) => event.type === "request.opened");
        const resolved = byThread(threadId).find((event) => event.type === "request.resolved");
        expect(resolved?.requestId).toBe(opened?.requestId);
      }
    }),
  );

  it.effect("loops under fresh ids when asked, and fails once exhausted otherwise", () =>
    Effect.gen(function* () {
      const recording = contractRecording(codex, "plain");
      const threadId = ThreadId.make("loop-thread");
      const playTurns = Effect.fnUntraced(function* (
        adapter: ProviderAdapterShape<ProviderAdapterError>,
        count: number,
      ) {
        const events = yield* collect(adapter);
        yield* adapter.startSession({ threadId, provider: codex, runtimeMode: "full-access" });
        const turnIds: Array<string> = [];
        for (let turn = 0; turn < count; turn += 1) {
          const result = yield* adapter.sendTurn({ threadId, input: "Again." });
          turnIds.push(result.turnId);
          yield* events.until(turnEnded(result.turnId));
        }
        return turnIds;
      });

      const looping = yield* makeReplayProviderAdapter({
        recording,
        speed: "instant",
        onExhausted: "loop",
      });
      const looped = yield* playTurns(looping, 3);
      expect(looped.map(recordedId)).toEqual(["turn-1", "turn-2", "turn-1"]);
      expect(namespaceOf(looped[1]!)).toBe(namespaceOf(looped[0]!));
      expect(namespaceOf(looped[2]!)).not.toBe(namespaceOf(looped[0]!));

      const strict = yield* makeReplayProviderAdapter({ recording, speed: "instant" });
      yield* playTurns(strict, 2);
      const error = yield* Effect.flip(strict.sendTurn({ threadId, input: "Again." }));
      expect(error._tag).toBe("ProviderAdapterValidationError");
    }),
  );
});

describe("ReplayProviderAdapter ids across adapters", () => {
  it.effect("never repeats ids between two adapters replaying the same thread", () =>
    Effect.gen(function* () {
      const codex = ProviderDriverKind.make("codex");
      const recording = contractRecording(codex, "plain");
      const threadId = ThreadId.make("same-thread");
      const ids: Array<Set<string>> = [];
      for (let run = 0; run < 2; run += 1) {
        const adapter = yield* makeReplayProviderAdapter({ recording, speed: "instant" });
        const events = yield* collect(adapter);
        yield* adapter.startSession({ threadId, provider: codex, runtimeMode: "full-access" });
        const turn = yield* adapter.sendTurn({ threadId, input: "Go." });
        yield* events.until(turnEnded(turn.turnId));
        ids.push(
          new Set(
            events.seen.flatMap((event) =>
              [event.eventId, event.turnId, event.itemId].filter((id) => id !== undefined),
            ),
          ),
        );
      }

      expect([...ids[0]!].filter((id) => ids[1]!.has(id))).toEqual([]);
    }),
  );
});

describe("ReplayProviderAdapter interrupts", () => {
  it.effect("keeps a finished turn's late events when the next turn is interrupted", () =>
    Effect.gen(function* () {
      const codex = ProviderDriverKind.make("codex");
      const base = contractRecording(codex, "plain");
      const firstTerminal = base.lines.findIndex(
        (line) => line.kind === "event" && line.event.type === "turn.completed",
      );
      const lateUsage = {
        kind: "event",
        dt: 300,
        event: {
          eventId: "late-usage",
          provider: codex,
          threadId: "thread-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          type: "thread.token-usage.updated",
          payload: { usage: { usedTokens: 120 } },
        },
      } as unknown as RecordingLine;
      const recording = {
        ...base,
        lines: [
          ...base.lines.slice(0, firstTerminal + 1),
          lateUsage,
          ...base.lines.slice(firstTerminal + 1),
        ],
      };
      const adapter = yield* makeReplayProviderAdapter({ recording, speed: 1 });
      const events = yield* collect(adapter);
      const threadId = ThreadId.make("late-thread");
      yield* adapter.startSession({ threadId, provider: codex, runtimeMode: "full-access" });
      const first = yield* adapter.sendTurn({ threadId, input: "One." });
      // Turn 1 ends 290 ms in (after the session start); its late usage lands at 590 ms.
      for (let elapsed = 0; elapsed < 300; elapsed += 10) yield* TestClock.adjust(10);
      yield* events.until(turnEnded(first.turnId));

      // Turn 2 starts and is interrupted before turn 1's late usage has played.
      const second = yield* adapter.sendTurn({ threadId, input: "Two." });
      yield* adapter.interruptTurn(threadId, second.turnId);
      yield* events.until(turnEnded(second.turnId));

      expect(events.seen.map((event) => event.type).slice(-2)).toEqual([
        "thread.token-usage.updated",
        "turn.completed",
      ]);
      expect(
        events.seen.some(
          (event) => event.type === "turn.started" && event.turnId === second.turnId,
        ),
      ).toBe(false);
    }),
  );

  const expected: Record<string, { readonly type: string; readonly payload: unknown }> = {
    codex: { type: "turn.completed", payload: { state: "interrupted" } },
    claudeAgent: { type: "turn.completed", payload: { state: "interrupted" } },
    cursor: { type: "turn.completed", payload: { state: "cancelled" } },
    grok: { type: "turn.completed", payload: { state: "cancelled" } },
    opencode: { type: "turn.aborted", payload: { reason: "interrupted" } },
    antigravity: { type: "turn.completed", payload: { state: "cancelled" } },
  };

  for (const provider of REPLAY_PROVIDERS) {
    it.effect(`ends an interrupted ${provider} turn the way ${provider} does`, () =>
      Effect.gen(function* () {
        const adapter = yield* makeReplayProviderAdapter({
          recording: contractRecording(provider, "plain"),
          speed: 1,
        });
        const events = yield* collect(adapter);
        const threadId = ThreadId.make("interrupt-thread");
        yield* adapter.startSession({ threadId, provider, runtimeMode: "full-access" });
        const turn = yield* adapter.sendTurn({ threadId, input: "Go." });

        // The clock has not moved: the session's start event and the whole
        // turn are still waiting to play when the interrupt arrives.
        yield* adapter.interruptTurn(threadId, turn.turnId);
        const terminal = yield* events.until(turnEnded(turn.turnId));

        expect(events.seen.map((event) => event.type)).toEqual(["session.started", terminal.type]);
        expect({ type: terminal.type, payload: terminal.payload }).toEqual(expected[provider]);
        // The next turn plays the recording's next turn.
        const next = yield* adapter.sendTurn({ threadId, input: "Go on." });
        expect(recordedId(next.turnId)).toBe("turn-2");
      }),
    );
  }
});
