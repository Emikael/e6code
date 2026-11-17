import { EnvironmentId, type DesktopLocalEnvironmentStatus } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canEnterApp,
  readLocalEnvironmentStatus,
  resolveRootGateMode,
} from "./localEnvironmentStatus";

const status = (state: DesktopLocalEnvironmentStatus["state"]): DesktopLocalEnvironmentStatus => ({
  state,
  environmentId: EnvironmentId.make("env-local"),
  label: "Local environment",
  sinceEpochMs: 0,
  restartAttempt: 0,
  reason: null,
});

describe("resolveRootGateMode", () => {
  it("keeps today's gate wherever the desktop reports no status", () => {
    // Browsers on every connection mode (local, LAN, Tailscale, tunnel or relay) have no
    // desktop bridge; desktops predating the status have the bridge without the member.
    expect(readLocalEnvironmentStatus(undefined)).toBeUndefined();
    expect(readLocalEnvironmentStatus({})).toBeUndefined();
    for (const authenticatedThisSession of [false, true]) {
      for (const hasPairingToken of [false, true]) {
        expect(
          resolveRootGateMode({
            localEnvironmentStatus: undefined,
            hasPairingToken,
            authenticatedThisSession,
          }),
        ).toBe("server");
      }
    }
  });

  it("keeps today's gate when the local environment is disabled", () => {
    expect(
      resolveRootGateMode({
        localEnvironmentStatus: null,
        hasPairingToken: false,
        authenticatedThisSession: false,
      }),
    ).toBe("server");
  });

  it("renders from cache until the local environment is ready", () => {
    for (const state of ["starting", "restarting", "failed", "stopped"] as const) {
      expect(
        resolveRootGateMode({
          localEnvironmentStatus: status(state),
          hasPairingToken: false,
          authenticatedThisSession: false,
        }),
      ).toBe("local-starting");
    }
    expect(
      resolveRootGateMode({
        localEnvironmentStatus: status("ready"),
        hasPairingToken: false,
        authenticatedThisSession: false,
      }),
    ).toBe("server");
  });

  it("always exchanges a pairing token from the URL", () => {
    expect(
      resolveRootGateMode({
        localEnvironmentStatus: status("starting"),
        hasPairingToken: true,
        authenticatedThisSession: false,
      }),
    ).toBe("server");
  });

  it("does not take an authenticated renderer back to starting when its backend restarts", () => {
    expect(
      resolveRootGateMode({
        localEnvironmentStatus: status("restarting"),
        hasPairingToken: false,
        authenticatedThisSession: true,
      }),
    ).toBe("server");
  });
});

describe("canEnterApp", () => {
  it("admits the app shell only for states that can show it", () => {
    expect(canEnterApp({ status: "authenticated" })).toBe(true);
    expect(canEnterApp({ status: "hosted-static" })).toBe(true);
    expect(canEnterApp({ status: "local-starting" })).toBe(true);
    expect(canEnterApp({ status: "requires-auth" })).toBe(false);
    expect(canEnterApp({ status: "hosted-pairing" })).toBe(false);
  });
});
