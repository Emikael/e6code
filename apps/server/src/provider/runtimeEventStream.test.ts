import {
  EventId,
  ProviderDriverKind,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@e6tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { makeQueuedRuntimeEventStream, makeRuntimeEventStream } from "./runtimeEventStream.ts";

const event: ProviderRuntimeEvent = {
  type: "session.exited",
  eventId: EventId.make("evt-fence"),
  provider: ProviderDriverKind.make("codex"),
  threadId: ThreadId.make("thread-fence"),
  createdAt: "2026-01-01T00:00:00.000Z",
  payload: { exitKind: "graceful" },
};

it.effect("captures the pubsub baseline and buffers a synchronous next publication", () =>
  Effect.gen(function* () {
    const broker = yield* makeRuntimeEventStream;
    broker.publishUnsafe(event);
    const scope = yield* Scope.make();
    const subscription = yield* broker.subscribeRuntimeEvents.pipe(Scope.provide(scope));
    assert.equal(subscription.sequence, 1);
    broker.publishUnsafe({ ...event, eventId: EventId.make("evt-after-subscription") });
    const entries = yield* Stream.runCollect(subscription.events.pipe(Stream.take(1)));
    assert.equal(entries[0]?.sequence, 2);
    assert.equal(yield* broker.runtimeEventSequence, 2);
    yield* Scope.close(scope, Exit.void);
    yield* broker.shutdown;
  }),
);

it.effect("retains queue publications from before the consumer starts", () =>
  Effect.gen(function* () {
    const broker = yield* makeQueuedRuntimeEventStream;
    broker.publishUnsafe(event);
    const subscription = yield* broker.subscribeRuntimeEvents;
    assert.equal(subscription.sequence, 0);
    const entries = yield* Stream.runCollect(subscription.events.pipe(Stream.take(1)));
    assert.deepEqual(entries, [{ sequence: 1, event }]);
    yield* broker.shutdown;
  }),
);
