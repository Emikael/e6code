import {
  AuthStandardClientScopes,
  EnvironmentId,
  PRIMARY_LOCAL_ENVIRONMENT_ID,
  type DesktopBridge,
  type DesktopLocalEnvironmentStatus,
  type DesktopSshEnvironmentTarget,
} from "@e6tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Chunk from "effect/Chunk";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import {
  canRetainCachedPlatformRegistrationAfterRefreshFailure,
  canReuseCachedPlatformRegistration,
  localEnvironmentStatusChanges,
  planPrimaryRegistration,
  primaryRegistrationToRetainAfterDiscoveryFailure,
  primaryRegistrationToRetainAfterTopologyRead,
  provisionDesktopSshEnvironment,
  readPrimaryEnvironmentTargetResult,
  secondaryRegistrationsToRetainAfterTopologyRead,
  secondaryBearerExpiresAtEpochMs,
  secondaryBearerRefreshAtEpochMs,
} from "./platform.ts";

const TARGET: DesktopSshEnvironmentTarget = {
  alias: "devbox",
  hostname: "devbox.example.test",
  username: "developer",
  port: 22,
};

function makeBridge(
  calls: string[],
  options?: { readonly failDescriptor?: boolean },
): DesktopBridge {
  return {
    ensureSshEnvironment: async (target: DesktopSshEnvironmentTarget) => {
      calls.push("ensure");
      return {
        target,
        httpBaseUrl: "http://127.0.0.1:3201/",
        wsBaseUrl: "ws://127.0.0.1:3201/",
        pairingToken: "pairing-token",
      };
    },
    fetchSshEnvironmentDescriptor: async () => {
      calls.push("descriptor");
      if (options?.failDescriptor === true) {
        throw new Error("descriptor unavailable");
      }
      return {
        environmentId: EnvironmentId.make("environment-ssh"),
        label: "SSH environment",
        platform: {
          os: "linux",
          arch: "x64",
        },
        serverVersion: "0.0.0-test",
        capabilities: {
          repositoryIdentity: true,
        },
      };
    },
    bootstrapSshBearerSession: async () => {
      calls.push("token");
      return {
        access_token: "bearer-token",
        issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
        token_type: "Bearer",
        expires_in: 3_600,
        scope: AuthStandardClientScopes.join(" "),
      };
    },
  } as unknown as DesktopBridge;
}

describe("desktop SSH pairing", () => {
  it.effect("fetches the descriptor before consuming the one-time credential", () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      const provisioned = yield* provisionDesktopSshEnvironment(makeBridge(calls), TARGET);

      expect(provisioned.environmentId).toBe(EnvironmentId.make("environment-ssh"));
      expect(calls).toEqual(["ensure", "descriptor", "token"]);
    }),
  );

  it.effect("does not consume the credential when descriptor discovery fails", () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      yield* provisionDesktopSshEnvironment(
        makeBridge(calls, { failDescriptor: true }),
        TARGET,
      ).pipe(Effect.flip);

      expect(calls).toEqual(["ensure", "descriptor"]);
    }),
  );
});

describe("desktop-local bearer cache", () => {
  const registration = {} as never;

  it("refreshes a secondary bearer before it expires", () => {
    const issuedAtEpochMs = 10_000;
    const refreshAtEpochMs = secondaryBearerRefreshAtEpochMs(issuedAtEpochMs, 60);
    const expiresAtEpochMs = secondaryBearerExpiresAtEpochMs(issuedAtEpochMs, 60);
    const cached = {
      expiresAtEpochMs,
      signature: "secondary-signature",
      registration,
      refreshAtEpochMs,
    };

    expect(refreshAtEpochMs).toBe(65_000);
    expect(canReuseCachedPlatformRegistration(cached, cached.signature, 64_999)).toBe(true);
    expect(canReuseCachedPlatformRegistration(cached, cached.signature, 65_000)).toBe(false);
    expect(
      canRetainCachedPlatformRegistrationAfterRefreshFailure(cached, cached.signature, 69_999),
    ).toBe(true);
    expect(
      canRetainCachedPlatformRegistrationAfterRefreshFailure(cached, cached.signature, 70_000),
    ).toBe(false);
  });

  it("does not cache credentials whose lifetime is shorter than the refresh skew", () => {
    const refreshAtEpochMs = secondaryBearerRefreshAtEpochMs(10_000, 3);
    const cached = {
      expiresAtEpochMs: secondaryBearerExpiresAtEpochMs(10_000, 3),
      signature: "secondary-signature",
      registration,
      refreshAtEpochMs,
    };

    expect(refreshAtEpochMs).toBe(10_000);
    expect(canReuseCachedPlatformRegistration(cached, cached.signature, 10_000)).toBe(false);
  });

  it("retains only unexpired secondaries after a topology read failure", () => {
    const valid = {
      expiresAtEpochMs: 20_000,
      signature: "valid-secondary",
      registration,
      refreshAtEpochMs: 15_000,
    };
    const previous = new Map([
      ["valid-secondary", valid],
      [
        "expired-secondary",
        {
          expiresAtEpochMs: 10_000,
          signature: "expired-secondary",
          registration,
          refreshAtEpochMs: 5_000,
        },
      ],
    ]);

    expect(
      secondaryRegistrationsToRetainAfterTopologyRead(
        previous,
        { _tag: "Failure", cause: new Error("IPC unavailable") },
        10_000,
      ),
    ).toEqual(new Map([["valid-secondary", valid]]));
  });

  it("treats a successful empty topology as authoritative removal", () => {
    const previous = new Map([
      [
        "secondary",
        {
          expiresAtEpochMs: 20_000,
          signature: "secondary",
          registration,
          refreshAtEpochMs: 15_000,
        },
      ],
    ]);

    expect(
      secondaryRegistrationsToRetainAfterTopologyRead(
        previous,
        { _tag: "Success", bootstraps: [] },
        10_000,
      ),
    ).toEqual(new Map());
  });
});

describe("primary topology cache", () => {
  const registration = {} as never;
  const cached = {
    signature: "primary|http://127.0.0.1:3773/|ws://127.0.0.1:3773/",
    registration,
  };
  const previous = new Map([[PRIMARY_LOCAL_ENVIRONMENT_ID, cached]]);

  it("captures synchronous primary target read failures", () => {
    const cause = new Error("invalid primary target");

    expect(
      readPrimaryEnvironmentTargetResult(() => {
        throw cause;
      }),
    ).toEqual({ _tag: "Failure", cause });
  });

  it("retains the cached primary after a transient topology read failure", () => {
    expect(
      primaryRegistrationToRetainAfterTopologyRead(previous, {
        _tag: "Failure",
        cause: new Error("IPC unavailable"),
      }),
    ).toBe(cached);
  });

  it("treats a successful primary absence as authoritative removal", () => {
    expect(
      primaryRegistrationToRetainAfterTopologyRead(previous, {
        _tag: "Success",
        target: null,
      }),
    ).toBeUndefined();
  });
});

describe("primary registration while the local environment starts", () => {
  const target = {
    source: "desktop-managed",
    target: { httpBaseUrl: "http://127.0.0.1:3773/", wsBaseUrl: "ws://127.0.0.1:3773/" },
  } as const;
  const signature = "primary|http://127.0.0.1:3773/|ws://127.0.0.1:3773/";
  const environmentId = EnvironmentId.make("env-local");
  const status = (
    state: DesktopLocalEnvironmentStatus["state"],
    id: EnvironmentId | null = environmentId,
  ): DesktopLocalEnvironmentStatus => ({
    state,
    environmentId: id,
    label: "Local environment",
    sinceEpochMs: 0,
    restartAttempt: 0,
    reason: null,
  });

  it("registers the persisted primary without asking the backend while it starts", () => {
    for (const state of ["starting", "restarting", "failed"] as const) {
      const plan = planPrimaryRegistration({
        target,
        signature,
        cached: undefined,
        localStatus: status(state),
        nowEpochMs: 0,
      });
      expect(plan._tag).toBe("Provisional");
      if (plan._tag !== "Provisional") return;
      expect(plan.cached.provisional).toBe(true);
      expect(plan.cached.registration.target).toMatchObject({
        _tag: "PrimaryConnectionTarget",
        environmentId,
        label: "Local environment",
        httpBaseUrl: "http://127.0.0.1:3773/",
        wsBaseUrl: "ws://127.0.0.1:3773/",
      });

      // Later reads keep the same registration, so the environment is never reinstalled.
      expect(
        planPrimaryRegistration({
          target,
          signature,
          cached: plan.cached,
          localStatus: status(state),
          nowEpochMs: 3_000,
        }),
      ).toEqual({ _tag: "Reuse", cached: plan.cached });
    }
  });

  it("waits without a persisted id instead of guessing one", () => {
    expect(
      planPrimaryRegistration({
        target,
        signature,
        cached: undefined,
        localStatus: status("starting", null),
        nowEpochMs: 0,
      }),
    ).toEqual({ _tag: "Wait" });
  });

  it("describes the backend once it is ready, and keeps the primary if that fails", () => {
    const provisional = planPrimaryRegistration({
      target,
      signature,
      cached: undefined,
      localStatus: status("starting"),
      nowEpochMs: 0,
    });
    if (provisional._tag !== "Provisional") throw new Error("expected a provisional plan");

    expect(
      planPrimaryRegistration({
        target,
        signature,
        cached: provisional.cached,
        localStatus: status("ready"),
        nowEpochMs: 3_000,
      }),
    ).toEqual({ _tag: "Discover" });
    // Dropping the primary would remove the environment and clear its cache and drafts.
    expect(primaryRegistrationToRetainAfterDiscoveryFailure(provisional.cached, signature)).toBe(
      provisional.cached,
    );
    expect(
      primaryRegistrationToRetainAfterDiscoveryFailure(provisional.cached, "primary|elsewhere"),
    ).toBeUndefined();
  });

  it("keeps today's discovery wherever the desktop reports no status", () => {
    for (const localStatus of [undefined, null]) {
      expect(
        planPrimaryRegistration({
          target,
          signature,
          cached: undefined,
          localStatus,
          nowEpochMs: 0,
        }),
      ).toEqual({ _tag: "Discover" });
    }
  });

  it.effect("reads the topology again on every status push", () =>
    Effect.gen(function* () {
      const listeners = yield* Queue.unbounded<(status: DesktopLocalEnvironmentStatus) => void>();
      let stopped = false;
      const bridge: Pick<DesktopBridge, "onLocalEnvironmentStatus"> = {
        onLocalEnvironmentStatus: (listener) => {
          Queue.offerUnsafe(listeners, listener);
          return () => {
            stopped = true;
          };
        },
      };

      const reads = yield* localEnvironmentStatusChanges(bridge).pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      const push = yield* Queue.take(listeners);
      push(status("restarting"));
      push(status("ready"));

      expect(Chunk.size(Chunk.fromIterable(yield* Fiber.join(reads)))).toBe(2);
      expect(stopped).toBe(true);
      expect(localEnvironmentStatusChanges(undefined)).toBe(Stream.empty);
    }),
  );
});
