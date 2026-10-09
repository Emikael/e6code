import type { ProviderRuntimeEvent } from "@e6tools/contracts";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

export const makeRuntimeEventStream = Effect.gen(function* () {
  const bus = yield* PubSub.unbounded<{
    readonly sequence: number;
    readonly event: ProviderRuntimeEvent;
  }>();
  let sequence = 0;
  const publishUnsafe = (event: ProviderRuntimeEvent) => {
    const next = sequence + 1;
    if (PubSub.publishUnsafe(bus, { sequence: next, event })) sequence = next;
  };
  const subscribeRuntimeEvents = Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    // Subscribe and capture the baseline in one synchronous step, including unsafe publishers.
    return yield* Effect.sync(() => {
      const subscription = Effect.runSync(PubSub.subscribe(bus).pipe(Scope.provide(scope)));
      return { sequence, events: Stream.fromSubscription(subscription) };
    });
  });
  return {
    publishUnsafe,
    publish: (event: ProviderRuntimeEvent) => Effect.sync(() => publishUnsafe(event)),
    runtimeEventSequence: Effect.sync(() => sequence),
    subscribeRuntimeEvents,
    streamEvents: Stream.fromPubSub(bus).pipe(Stream.map(({ event }) => event)),
    shutdown: PubSub.shutdown(bus),
  };
});

export const makeQueuedRuntimeEventStream = Effect.gen(function* () {
  const queue = yield* Queue.unbounded<{
    readonly sequence: number;
    readonly event: ProviderRuntimeEvent;
  }>();
  let sequence = 0;
  const publishUnsafe = (event: ProviderRuntimeEvent) => {
    const next = sequence + 1;
    if (Queue.offerUnsafe(queue, { sequence: next, event })) sequence = next;
  };
  const events = Stream.fromQueue(queue);
  return {
    publishUnsafe,
    publish: (event: ProviderRuntimeEvent) => Effect.sync(() => publishUnsafe(event)),
    runtimeEventSequence: Effect.sync(() => sequence),
    // Queue adapters have one consumer and retain all events published before it attaches.
    subscribeRuntimeEvents: Effect.succeed({ sequence: 0, events }),
    streamEvents: events.pipe(Stream.map(({ event }) => event)),
    shutdown: Queue.shutdown(queue),
  };
});
