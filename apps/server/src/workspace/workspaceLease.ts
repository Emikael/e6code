// @effect-diagnostics nodeBuiltinImport:off - Lease keys use native path semantics without adding a service requirement to callers.
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

const leases = new Map<string, { semaphore: Semaphore.Semaphore; users: number }>();

/** Checkout removal also excludes startup in directories beneath that checkout. */
export const withWorkspaceLease = <A, E, R>(
  cwd: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    const overlaps = (left: string, right: string) => {
      const relative = NodePath.relative(left, right);
      return (
        relative === "" ||
        (relative !== ".." &&
          !relative.startsWith(`..${NodePath.sep}`) &&
          !NodePath.isAbsolute(relative))
      );
    };
    if (!leases.has(cwd)) leases.set(cwd, { semaphore: Semaphore.makeUnsafe(1), users: 0 });
    const related = [...leases.entries()]
      .filter(([key]) => overlaps(cwd, key) || overlaps(key, cwd))
      .sort(([left], [right]) => left.localeCompare(right));
    for (const [, lease] of related) lease.users++;
    return related
      .reduceRight((locked, [, lease]) => lease.semaphore.withPermit(locked), effect)
      .pipe(
        Effect.ensuring(
          Effect.sync(() => {
            for (const [key, lease] of related) {
              lease.users--;
              if (lease.users === 0) leases.delete(key);
            }
          }),
        ),
      );
  });
