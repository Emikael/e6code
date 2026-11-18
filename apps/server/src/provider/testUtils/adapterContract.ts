/**
 * Behavioural contract every provider adapter must keep for ProviderService:
 * session lifecycle, turn and event invariants, the single-subscriber event
 * stream and its sequence watermark, and typed errors for unknown threads.
 *
 * `runAdapterContract` registers the checks for one adapter subject. Subjects
 * that can pause a turn on an approval or question also opt into the gated
 * checks. Today the replay adapter and the scripted TestProviderAdapter run
 * it; the real provider adapters do not, since they need their CLIs.
 *
 * @module provider/testUtils/adapterContract
 */
import {
  ProviderDriverKind,
  ProviderRuntimeEvent,
  ThreadId,
  type ProviderSendTurnInput,
  type TurnId,
} from "@e6tools/contracts";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";

export interface AdapterContractSubject {
  readonly adapter: ProviderAdapterShape<ProviderAdapterError>;
  /** Prepares the next turn on a thread, for adapters scripted per turn. */
  readonly arrangeTurn?: (threadId: ThreadId) => Effect.Effect<void, ProviderAdapterError>;
}

export type AdapterContractScenario = "plain" | "approval" | "user-input";

export interface AdapterContractTarget {
  readonly name: string;
  readonly provider: ProviderDriverKind;
  /**
   * Builds a fresh adapter whose turns play the scenario. "plain" turns emit
   * a short assistant reply and complete; "approval" and "user-input" turns
   * open one request and wait for the answer.
   */
  readonly makeSubject: (
    scenario: AdapterContractScenario,
  ) => Effect.Effect<AdapterContractSubject, ProviderAdapterError, Scope.Scope>;
  /** startSession rejects an `input.provider` naming another driver. */
  readonly validatesProviderMismatch: boolean;
  /** The subject pauses turns on approvals and questions until answered. */
  readonly gates: boolean;
  /** A declined approval can carry the user's instructions to the provider. */
  readonly nativeApprovalFeedback: boolean;
}

interface Sequenced {
  readonly sequence: number;
  readonly event: ProviderRuntimeEvent;
}

const decodeEvent = Schema.decodeUnknownExit(ProviderRuntimeEvent);
const isTerminal = (event: ProviderRuntimeEvent) =>
  event.type === "turn.completed" || event.type === "turn.aborted";

/** Subscribes once and buffers every delivered event so checks never drop any. */
const observe = Effect.fnUntraced(function* (subject: AdapterContractSubject) {
  const subscription = yield* subject.adapter.subscribeRuntimeEvents;
  const delivered = yield* Queue.unbounded<Sequenced>();
  const seen: Array<Sequenced> = [];
  yield* subscription.events.pipe(
    Stream.runForEach((entry) =>
      Effect.sync(() => seen.push(entry)).pipe(Effect.andThen(Queue.offer(delivered, entry))),
    ),
    Effect.forkScoped,
  );
  const next = Queue.take(delivered);
  const nextMatching = Effect.fnUntraced(function* (
    predicate: (event: ProviderRuntimeEvent) => boolean,
  ) {
    while (true) {
      const entry = yield* next;
      if (predicate(entry.event)) return entry.event;
    }
  });
  return { baseline: subscription.sequence, seen, next, nextMatching };
});

/** Lets every runnable fiber publish what it can before a check. */
const settle = Effect.forEach(Array.from({ length: 16 }), () => Effect.yieldNow, {
  discard: true,
});

const sequenceOf = (
  observed: { readonly seen: ReadonlyArray<Sequenced> },
  event: ProviderRuntimeEvent,
) => observed.seen.find((entry) => entry.event === event)?.sequence;

const startInput = (provider: ProviderDriverKind, threadId: string) => ({
  threadId: ThreadId.make(threadId),
  provider,
  runtimeMode: "approval-required" as const,
});

const turnInput = (threadId: ThreadId): ProviderSendTurnInput => ({
  threadId,
  input: "Run the contract turn.",
});

const sendTurn = Effect.fnUntraced(function* (subject: AdapterContractSubject, threadId: ThreadId) {
  if (subject.arrangeTurn) yield* subject.arrangeTurn(threadId);
  return yield* subject.adapter.sendTurn(turnInput(threadId));
});

/** Fails the test unless the call fails with one of the typed errors (a defect fails it too). */
const expectFailureTag = Effect.fnUntraced(function* <A, E>(
  effect: Effect.Effect<A, E>,
  tags: ReadonlyArray<string>,
) {
  const error = yield* Effect.flip(effect);
  expect(tags).toContain((error as { readonly _tag?: string })._tag);
});

export function runAdapterContract(target: AdapterContractTarget): void {
  const { provider } = target;

  describe(`${target.name}: adapter contract`, () => {
    it.effect("C1 declares its provider and model-switch capability", () =>
      Effect.gen(function* () {
        const { adapter } = yield* target.makeSubject("plain");
        expect(adapter.provider).toBe(provider);
        expect(["in-session", "unsupported"]).toContain(adapter.capabilities.sessionModelSwitch);
      }),
    );

    it.effect("C2 starts sessions that hasSession and listSessions report", () =>
      Effect.gen(function* () {
        const { adapter } = yield* target.makeSubject("plain");
        const session = yield* adapter.startSession(startInput(provider, "contract-c2"));

        expect(session.threadId).toBe("contract-c2");
        expect(session.provider).toBe(provider);
        expect(yield* adapter.hasSession(session.threadId)).toBe(true);
        const listed = yield* adapter.listSessions();
        expect(listed.map((entry) => entry.threadId)).toContain(session.threadId);
      }),
    );

    if (target.validatesProviderMismatch) {
      it.effect("C3 rejects a session for another provider", () =>
        Effect.gen(function* () {
          const { adapter } = yield* target.makeSubject("plain");
          const other = ProviderDriverKind.make(provider === "codex" ? "cursor" : "codex");
          yield* expectFailureTag(
            adapter.startSession({ ...startInput(provider, "contract-c3"), provider: other }),
            ["ProviderAdapterValidationError"],
          );
        }),
      );
    }

    it.effect("C4 fails calls on an unknown thread with typed errors", () =>
      Effect.gen(function* () {
        const { adapter } = yield* target.makeSubject("plain");
        const unknown = ThreadId.make("contract-unknown");
        const missing = [
          "ProviderAdapterSessionNotFoundError",
          "ProviderAdapterSessionClosedError",
        ];

        yield* expectFailureTag(adapter.sendTurn(turnInput(unknown)), missing);
        yield* expectFailureTag(adapter.interruptTurn(unknown), missing);
        yield* expectFailureTag(
          adapter.respondToRequest(unknown, "req" as never, "accept"),
          missing,
        );
        yield* expectFailureTag(adapter.respondToUserInput(unknown, "req" as never, {}), missing);
        yield* expectFailureTag(adapter.readThread(unknown), missing);
        yield* expectFailureTag(adapter.rollbackThread(unknown, 0), missing);
        // Adapters differ today: Codex ignores an unknown stop, the others fail.
        const stop = yield* Effect.exit(adapter.stopSession(unknown));
        if (Exit.isFailure(stop)) yield* expectFailureTag(adapter.stopSession(unknown), missing);
      }),
    );

    it.effect("C5–C7 turns carry their turn id, end once, and stream valid sequenced events", () =>
      Effect.gen(function* () {
        const subject = yield* target.makeSubject("plain");
        const { adapter } = subject;
        const observed = yield* observe(subject);
        const session = yield* adapter.startSession(startInput(provider, "contract-c5"));
        const turnIds: Array<TurnId> = [];
        for (let turn = 0; turn < 2; turn += 1) {
          const result = yield* sendTurn(subject, session.threadId);
          expect(result.threadId).toBe(session.threadId);
          turnIds.push(result.turnId);
          yield* observed.nextMatching(
            (event) => isTerminal(event) && event.turnId === result.turnId,
          );
        }

        const events = observed.seen.map((entry) => entry.event);
        for (const event of events) {
          assert.isTrue(Exit.isSuccess(decodeEvent(event)), `${event.type} decodes`);
          expect(event.provider).toBe(provider);
          expect(event.providerInstanceId).toBeUndefined();
          expect(event.threadId).toBe(session.threadId);
        }
        expect(new Set(events.map((event) => event.eventId)).size).toBe(events.length);
        for (const turnId of turnIds) {
          const turnEvents = events.filter((event) => event.turnId === turnId);
          expect(turnEvents.length).toBeGreaterThan(1);
          expect(turnEvents.filter(isTerminal)).toHaveLength(1);
          expect(isTerminal(turnEvents.at(-1)!)).toBe(true);
        }
        expect(
          events
            .filter((event) => event.turnId !== undefined)
            .every((event) => turnIds.includes(event.turnId!)),
        ).toBe(true);

        const sequences = observed.seen.map((entry) => entry.sequence);
        expect(sequences).toEqual(sequences.map((_, index) => observed.baseline + index + 1));
        expect(yield* adapter.runtimeEventSequence).toBe(sequences.at(-1));
      }),
    );

    it.effect("C8 stopSession removes the session, silences it and keeps the stream open", () =>
      Effect.gen(function* () {
        const subject = yield* target.makeSubject("plain");
        const { adapter } = subject;
        const observed = yield* observe(subject);
        const first = yield* adapter.startSession(startInput(provider, "contract-c8-a"));
        const second = yield* adapter.startSession(startInput(provider, "contract-c8-b"));
        yield* sendTurn(subject, first.threadId);

        yield* adapter.stopSession(first.threadId);
        const watermark = yield* adapter.runtimeEventSequence;

        expect(yield* adapter.hasSession(first.threadId)).toBe(false);
        const listed = yield* adapter.listSessions();
        expect(listed.map((entry) => entry.threadId)).toEqual([second.threadId]);
        const result = yield* sendTurn(subject, second.threadId);
        // Turn ids are only unique within a thread.
        yield* observed.nextMatching(
          (event) =>
            isTerminal(event) &&
            event.threadId === second.threadId &&
            event.turnId === result.turnId,
        );
        const lateEvents = observed.seen.filter(
          (entry) => entry.sequence > watermark && entry.event.threadId === first.threadId,
        );
        expect(lateEvents).toEqual([]);
      }),
    );

    it.effect("C9 reads and rolls back turns when the adapter supports rollback", () =>
      Effect.gen(function* () {
        const subject = yield* target.makeSubject("plain");
        const { adapter } = subject;
        const observed = yield* observe(subject);
        const session = yield* adapter.startSession(startInput(provider, "contract-c9"));
        for (let turn = 0; turn < 2; turn += 1) {
          const result = yield* sendTurn(subject, session.threadId);
          yield* observed.nextMatching(
            (event) => isTerminal(event) && event.turnId === result.turnId,
          );
        }

        if (adapter.capabilities.supportsConversationRollback === false) {
          yield* expectFailureTag(adapter.rollbackThread(session.threadId, 1), [
            "ProviderAdapterValidationError",
          ]);
          return;
        }
        expect((yield* adapter.readThread(session.threadId)).turns).toHaveLength(2);
        expect((yield* adapter.rollbackThread(session.threadId, 1)).turns).toHaveLength(1);
        yield* expectFailureTag(adapter.rollbackThread(session.threadId, 5), [
          "ProviderAdapterValidationError",
        ]);
      }),
    );

    it.effect("C10 stopAll leaves no sessions", () =>
      Effect.gen(function* () {
        const { adapter } = yield* target.makeSubject("plain");
        yield* adapter.startSession(startInput(provider, "contract-c10-a"));
        yield* adapter.startSession(startInput(provider, "contract-c10-b"));

        yield* adapter.stopAll();

        expect(yield* adapter.listSessions()).toEqual([]);
      }),
    );

    if (!target.gates) return;

    it.effect("G1 holds the turn at an approval until it is answered", () =>
      Effect.gen(function* () {
        const subject = yield* target.makeSubject("approval");
        const { adapter } = subject;
        const observed = yield* observe(subject);
        const session = yield* adapter.startSession(startInput(provider, "contract-g1"));
        const turn = yield* sendTurn(subject, session.threadId);
        const opened = yield* observed.nextMatching((event) => event.type === "request.opened");
        // Nothing past the gate is published while the request is open.
        yield* settle;
        expect(yield* adapter.runtimeEventSequence).toBe(sequenceOf(observed, opened));

        yield* adapter.respondToRequest(session.threadId, opened.requestId as never, "decline");
        const resolved = yield* observed.nextMatching((event) => event.type === "request.resolved");
        expect(resolved.requestId).toBe(opened.requestId);
        expect(resolved.payload).toMatchObject({ decision: "decline" });
        yield* observed.nextMatching((event) => isTerminal(event) && event.turnId === turn.turnId);
      }),
    );

    it.effect("G2 rejects an answer to an unknown request", () =>
      Effect.gen(function* () {
        const subject = yield* target.makeSubject("approval");
        const { adapter } = subject;
        const observed = yield* observe(subject);
        const session = yield* adapter.startSession(startInput(provider, "contract-g2"));
        yield* sendTurn(subject, session.threadId);
        yield* observed.nextMatching((event) => event.type === "request.opened");

        yield* expectFailureTag(
          adapter.respondToRequest(session.threadId, "not-a-request" as never, "accept"),
          ["ProviderAdapterRequestError"],
        );
      }),
    );

    it.effect("G3 holds the turn at a question until it is answered", () =>
      Effect.gen(function* () {
        const subject = yield* target.makeSubject("user-input");
        const { adapter } = subject;
        const observed = yield* observe(subject);
        const session = yield* adapter.startSession(startInput(provider, "contract-g3"));
        const turn = yield* sendTurn(subject, session.threadId);
        const requested = yield* observed.nextMatching(
          (event) => event.type === "user-input.requested",
        );
        yield* settle;
        expect(yield* adapter.runtimeEventSequence).toBe(sequenceOf(observed, requested));

        yield* adapter.respondToUserInput(session.threadId, requested.requestId as never, {
          q1: "Formatter",
        });
        const resolved = yield* observed.nextMatching(
          (event) => event.type === "user-input.resolved",
        );
        expect(resolved.payload).toEqual({ answers: { q1: "Formatter" } });
        yield* observed.nextMatching((event) => isTerminal(event) && event.turnId === turn.turnId);
      }),
    );

    it.effect("G4 an interrupt ends the running turn once and is a no-op when idle", () =>
      Effect.gen(function* () {
        const subject = yield* target.makeSubject("approval");
        const { adapter } = subject;
        const observed = yield* observe(subject);
        const session = yield* adapter.startSession(startInput(provider, "contract-g4"));
        yield* adapter.interruptTurn(session.threadId);
        const turn = yield* sendTurn(subject, session.threadId);
        yield* observed.nextMatching((event) => event.type === "request.opened");

        yield* adapter.interruptTurn(session.threadId, turn.turnId);
        const terminal = yield* observed.nextMatching(isTerminal);

        expect(terminal.turnId).toBe(turn.turnId);
        const sequence = yield* adapter.runtimeEventSequence;
        yield* adapter.interruptTurn(session.threadId, turn.turnId);
        expect(yield* adapter.runtimeEventSequence).toBe(sequence);
      }),
    );

    if (!target.nativeApprovalFeedback) return;

    it.effect("G5 accepts a declined approval with feedback", () =>
      Effect.gen(function* () {
        const subject = yield* target.makeSubject("approval");
        const { adapter } = subject;
        expect(adapter.capabilities.approvalFeedback).toBe("native");
        const observed = yield* observe(subject);
        const session = yield* adapter.startSession(startInput(provider, "contract-g5"));
        yield* sendTurn(subject, session.threadId);
        const opened = yield* observed.nextMatching((event) => event.type === "request.opened");

        yield* adapter.respondToRequest(
          session.threadId,
          opened.requestId as never,
          "decline",
          "Use the existing helper instead.",
        );
        const resolved = yield* observed.nextMatching((event) => event.type === "request.resolved");
        expect(resolved.payload).toMatchObject({ decision: "decline" });
      }),
    );
  });
}
