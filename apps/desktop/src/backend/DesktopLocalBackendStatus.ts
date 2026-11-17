import type { DesktopLocalEnvironmentStatus, EnvironmentId } from "@e6tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

const MAX_REASON_LENGTH = 500;

/**
 * Reduces an exit reason or error text to the single line the renderer shows: the first
 * non-empty line, whitespace collapsed, without the stack that follows it.
 */
export function toStatusReason(text: string): string | null {
  const firstLine = text
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .find((line) => line.length > 0);
  if (firstLine === undefined) return null;
  return firstLine.length > MAX_REASON_LENGTH
    ? `${firstLine.slice(0, MAX_REASON_LENGTH - 1)}…`
    : firstLine;
}

/**
 * The local environment's lifecycle as the renderer sees it. Startup begins it, the backend
 * pool's callbacks for the primary move it, and IPC exposes it as a synchronous read plus a
 * push channel. It stays `null` while the local environment is disabled.
 */
export class DesktopLocalBackendStatus extends Context.Service<
  DesktopLocalBackendStatus,
  {
    readonly get: Effect.Effect<DesktopLocalEnvironmentStatus | null>;
    /** The current status, then every change. */
    readonly changes: Stream.Stream<DesktopLocalEnvironmentStatus | null>;
    /** Startup knows what the backend will be before it spawns. */
    readonly begin: (input: {
      readonly environmentId: EnvironmentId | null;
      readonly label: string;
    }) => Effect.Effect<void>;
    readonly markReady: Effect.Effect<void>;
    /** The backend went away while it should keep running; a restart follows. */
    readonly markNotReady: Effect.Effect<void>;
    readonly markRestartScheduled: (restart: {
      readonly reason: string;
      readonly attempt: number;
    }) => Effect.Effect<void>;
    readonly markFailed: (reason: string) => Effect.Effect<void>;
    readonly markStopped: Effect.Effect<void>;
  }
>()("@e6tools/desktop/backend/DesktopLocalBackendStatus") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const ref = yield* SubscriptionRef.make<DesktopLocalEnvironmentStatus | null>(null);

  // Transitions before `begin` have nothing to describe, so they are dropped.
  const transition = (
    next: (
      current: DesktopLocalEnvironmentStatus,
      nowEpochMs: number,
    ) => DesktopLocalEnvironmentStatus,
  ) =>
    Clock.currentTimeMillis.pipe(
      Effect.flatMap((nowEpochMs) =>
        SubscriptionRef.update(ref, (current) =>
          current === null ? current : next(current, nowEpochMs),
        ),
      ),
    );

  const enter = (
    current: DesktopLocalEnvironmentStatus,
    nowEpochMs: number,
    patch: Pick<DesktopLocalEnvironmentStatus, "state" | "restartAttempt" | "reason">,
  ): DesktopLocalEnvironmentStatus => ({
    ...current,
    ...patch,
    sinceEpochMs: current.state === patch.state ? current.sinceEpochMs : nowEpochMs,
  });

  return DesktopLocalBackendStatus.of({
    get: SubscriptionRef.get(ref),
    changes: SubscriptionRef.changes(ref),
    begin: ({ environmentId, label }) =>
      Clock.currentTimeMillis.pipe(
        Effect.flatMap((nowEpochMs) =>
          SubscriptionRef.set(ref, {
            state: "starting",
            environmentId,
            label,
            sinceEpochMs: nowEpochMs,
            restartAttempt: 0,
            reason: null,
          }),
        ),
      ),
    markReady: transition((current, now) =>
      enter(current, now, { state: "ready", restartAttempt: 0, reason: null }),
    ),
    markNotReady: transition((current, now) =>
      enter(current, now, {
        state: "restarting",
        restartAttempt: current.restartAttempt,
        reason: current.state === "restarting" ? current.reason : null,
      }),
    ),
    markRestartScheduled: ({ reason, attempt }) =>
      transition((current, now) =>
        enter(current, now, {
          state: "restarting",
          restartAttempt: attempt,
          reason: toStatusReason(reason),
        }),
      ),
    markFailed: (reason) =>
      transition((current, now) =>
        enter(current, now, {
          state: "failed",
          restartAttempt: current.restartAttempt,
          reason: toStatusReason(reason) ?? "The local environment could not start.",
        }),
      ),
    markStopped: transition((current, now) =>
      enter(current, now, { state: "stopped", restartAttempt: 0, reason: null }),
    ),
  });
});

export const layer = Layer.effect(DesktopLocalBackendStatus, make);
