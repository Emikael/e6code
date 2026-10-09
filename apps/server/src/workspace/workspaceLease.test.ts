import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { withWorkspaceLease } from "./workspaceLease.ts";

for (const [held, waiting] of [
  ["/workspace/project", "/workspace/project/subdir"],
  ["/workspace/project/subdir", "/workspace/project"],
] as const) {
  it.effect(`serializes overlapping workspace paths ${held} and ${waiting}`, () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const first = yield* withWorkspaceLease(held, Deferred.await(release)).pipe(
        Effect.forkScoped({ startImmediately: true }),
      );
      const second = yield* withWorkspaceLease(waiting, Deferred.succeed(entered, undefined)).pipe(
        Effect.forkScoped({ startImmediately: true }),
      );
      assert.strictEqual(yield* Deferred.isDone(entered), false);
      yield* withWorkspaceLease("/workspace/project-other", Effect.void);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      assert.strictEqual(yield* Deferred.isDone(entered), true);
    }).pipe(Effect.scoped),
  );
}

it.effect("an interrupted overlapping waiter releases its lease references", () =>
  Effect.gen(function* () {
    const release = yield* Deferred.make<void>();
    const first = yield* withWorkspaceLease("/workspace/interrupted", Deferred.await(release)).pipe(
      Effect.forkScoped({ startImmediately: true }),
    );
    const waiting = yield* withWorkspaceLease("/workspace/interrupted/child", Effect.void).pipe(
      Effect.forkScoped({ startImmediately: true }),
    );
    yield* Fiber.interrupt(waiting);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(first);
    yield* withWorkspaceLease("/workspace/interrupted/child", Effect.void);
    yield* withWorkspaceLease("/workspace/interrupted", Effect.void);
  }).pipe(Effect.scoped),
);
