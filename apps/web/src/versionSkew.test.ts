import { EnvironmentId } from "@e6tools/contracts";
import type { ServerUpdateState } from "@e6tools/client-runtime/state/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// Pinned so the direction cases below read as fixed versions instead of
// arithmetic on whatever version this checkout happens to be at.
const branding = vi.hoisted(() => ({ APP_VERSION: "0.0.34" }));
vi.mock("./branding", () => branding);

import { APP_VERSION } from "./branding";
import {
  buildVersionMismatchDismissalKey,
  dismissServerUpdateFailure,
  dismissVersionMismatch,
  isServerUpdateFailureDismissed,
  isVersionMismatchDismissed,
  resolveServerConfigVersionMismatch,
  resolveServerReleaseStatus,
  resolveServerSelfUpdateCapability,
  resolveVersionMismatch,
  serverUpdateGuidance,
  supportsDesktopAppUpdate,
} from "./versionSkew";

const MISMATCH_HINT =
  "Version mismatch. Try syncing the client and server to the same E6 Code version.";

describe("versionSkew", () => {
  beforeEach(() => {
    branding.APP_VERSION = "0.0.34";
  });

  it("dismisses only the current failed attempt without clearing its retry state", () => {
    const failure = {
      status: "failed",
      stage: "downloading",
      fromVersion: "0.0.33",
      targetVersion: "0.0.34",
      message: "Download failed.",
    } as const satisfies ServerUpdateState;
    const retryFailure = { ...failure };
    const otherEnvironmentFailure = { ...failure };

    dismissServerUpdateFailure(failure);

    expect(isServerUpdateFailureDismissed(failure)).toBe(true);
    expect(failure.status).toBe("failed");
    expect(failure.message).toBe("Download failed.");
    expect(isServerUpdateFailureDismissed(retryFailure)).toBe(false);
    expect(isServerUpdateFailureDismissed(otherEnvironmentFailure)).toBe(false);
  });

  it("does not dismiss an update that is still running", () => {
    const running = {
      status: "running",
      stage: "resuming",
      fromVersion: "0.0.33",
      targetVersion: "0.0.34",
    } as const satisfies ServerUpdateState;

    dismissServerUpdateFailure(running);

    expect(isServerUpdateFailureDismissed(running)).toBe(false);
  });

  it("does not warn when versions match", () => {
    expect(resolveVersionMismatch(APP_VERSION)).toBeNull();
  });

  it("returns a mismatch when the server is behind the client", () => {
    expect(resolveVersionMismatch("0.0.33")).toEqual({
      clientVersion: "0.0.34",
      serverVersion: "0.0.33",
      hint: MISMATCH_HINT,
    });
  });

  it("does not warn when the server is ahead of the client", () => {
    expect(resolveVersionMismatch("0.0.35")).toBeNull();
    expect(resolveVersionMismatch("9.9.9")).toBeNull();
  });

  it("does not warn when a nightly and a stable build share a core version", () => {
    expect(resolveVersionMismatch("0.0.34-nightly.20260818.1124")).toBeNull();

    branding.APP_VERSION = "0.0.34-nightly.20260818.1124";
    expect(resolveVersionMismatch("0.0.34")).toBeNull();
  });

  it.each(["0.0.34-nightly.20260823.1124", "0.0.34-nightly.20260824.1124"])(
    "warns when nightly server %s is behind a nightly client on the same release",
    (serverVersion) => {
      branding.APP_VERSION = "0.0.34-nightly.20260824.1125";

      expect(resolveVersionMismatch(serverVersion)).toEqual({
        clientVersion: "0.0.34-nightly.20260824.1125",
        serverVersion,
        hint: MISMATCH_HINT,
      });
    },
  );

  it("does not warn when a nightly server is ahead on the same release", () => {
    branding.APP_VERSION = "0.0.34-nightly.20260824.1125";

    expect(resolveVersionMismatch("0.0.34-nightly.20260824.1126")).toBeNull();
  });

  it("treats a nightly server built past the client as ahead, not skew", () => {
    expect(resolveVersionMismatch("0.0.35-nightly.20260818.1124")).toBeNull();
  });

  it("still warns when a nightly client outruns the server by a release", () => {
    branding.APP_VERSION = "0.0.35-nightly.20260818.1124";

    expect(resolveVersionMismatch("0.0.34")).toEqual({
      clientVersion: "0.0.35-nightly.20260818.1124",
      serverVersion: "0.0.34",
      hint: MISMATCH_HINT,
    });
  });

  it("falls back to string inequality when a version is not semver", () => {
    expect(resolveVersionMismatch("dev")).toEqual({
      clientVersion: "0.0.34",
      serverVersion: "dev",
      hint: MISMATCH_HINT,
    });

    branding.APP_VERSION = "dev";
    expect(resolveVersionMismatch("dev")).toBeNull();
    expect(resolveVersionMismatch("0.0.34")).toMatchObject({ serverVersion: "0.0.34" });
  });

  it("reads the server version from config descriptors", () => {
    expect(
      resolveServerConfigVersionMismatch({
        environment: {
          environmentId: EnvironmentId.make("environment-1"),
          label: "Remote",
          platform: {
            os: "darwin",
            arch: "arm64",
          },
          serverVersion: "0.0.33",
          capabilities: {
            repositoryIdentity: true,
          },
        },
      }),
    ).toMatchObject({
      serverVersion: "0.0.33",
    });
  });

  it("keys dismissals by environment, client version, and server version", () => {
    const environmentId = EnvironmentId.make("environment-dismissal");
    const key = buildVersionMismatchDismissalKey(environmentId, {
      clientVersion: APP_VERSION,
      serverVersion: "9.9.9",
    });

    expect(key).toBe(`${environmentId}:${APP_VERSION}:9.9.9`);
    expect(isVersionMismatchDismissed(key)).toBe(false);

    dismissVersionMismatch(key);

    expect(isVersionMismatchDismissed(key)).toBe(true);
    expect(
      isVersionMismatchDismissed(
        buildVersionMismatchDismissalKey(environmentId, {
          clientVersion: APP_VERSION,
          serverVersion: "9.9.10",
        }),
      ),
    ).toBe(false);
  });

  it("reads desktop-managed update capabilities from config descriptors", () => {
    expect(
      resolveServerSelfUpdateCapability({
        environment: {
          environmentId: EnvironmentId.make("environment-desktop"),
          label: "Desktop",
          platform: { os: "darwin", arch: "arm64" },
          serverVersion: "9.9.9",
          capabilities: {
            repositoryIdentity: true,
            serverSelfUpdate: "desktop-managed",
          },
        },
      }),
    ).toBe("desktop-managed");
    expect(resolveServerSelfUpdateCapability(null)).toBeNull();
  });

  it("detects remote desktop-app update support from config descriptors", () => {
    const descriptor = (desktopAppUpdate?: boolean) => ({
      environment: {
        environmentId: EnvironmentId.make("environment-desktop"),
        label: "Desktop",
        platform: { os: "darwin", arch: "arm64" } as const,
        serverVersion: "9.9.9",
        capabilities: {
          repositoryIdentity: true,
          serverSelfUpdate: "desktop-managed" as const,
          ...(desktopAppUpdate === undefined ? {} : { desktopAppUpdate }),
        },
      },
    });

    expect(supportsDesktopAppUpdate(descriptor(true))).toBe(true);
    expect(supportsDesktopAppUpdate(descriptor(false))).toBe(false);
    expect(supportsDesktopAppUpdate(descriptor())).toBe(false);
    expect(supportsDesktopAppUpdate(null)).toBe(false);
  });

  it("matches version-drift guidance to the advertised update path", () => {
    expect(serverUpdateGuidance("respawn")).toBe("Update to stay in sync");
    expect(serverUpdateGuidance("desktop-managed")).toBe("Update the desktop app");
  });

  describe("resolveServerReleaseStatus", () => {
    const serverConfig = (serverVersion: string, serverUpdateCheck = true) => ({
      environment: {
        environmentId: EnvironmentId.make("environment-primary"),
        label: "Local",
        platform: { os: "darwin", arch: "arm64" } as const,
        serverVersion,
        capabilities: { repositoryIdentity: true, serverUpdateCheck },
      },
    });
    const check = (currentVersion: string, latestVersion: string | null) => ({
      currentVersion,
      latestVersion,
      updateAvailable: latestVersion !== null && latestVersion !== currentVersion,
      checkedAt: latestVersion === null ? null : "2026-10-31T12:00:00.000Z",
    });

    it("is unsupported when the server cannot check for releases", () => {
      expect(
        resolveServerReleaseStatus({
          serverConfig: serverConfig("0.0.34", false),
          check: check("0.0.34", "0.0.35"),
          bundleFromServer: true,
        }),
      ).toEqual({ kind: "unsupported" });
      expect(
        resolveServerReleaseStatus({ serverConfig: null, check: null, bundleFromServer: true }),
      ).toEqual({ kind: "unsupported" });
    });

    it("is unsupported for preview servers, which have no release track", () => {
      expect(
        resolveServerReleaseStatus({
          serverConfig: serverConfig("0.0.34-preview.20260728.12"),
          check: check("0.0.34-preview.20260728.12", null),
          bundleFromServer: false,
        }),
      ).toEqual({ kind: "unsupported" });
    });

    it("offers the newest release when the server is behind it", () => {
      expect(
        resolveServerReleaseStatus({
          serverConfig: serverConfig("0.0.34"),
          check: check("0.0.34", "0.0.35"),
          bundleFromServer: true,
        }),
      ).toEqual({ kind: "available", targetVersion: "0.0.35" });
    });

    it("reports up to date with the time of the last lookup", () => {
      expect(
        resolveServerReleaseStatus({
          serverConfig: serverConfig("0.0.34"),
          check: check("0.0.34", "0.0.34"),
          bundleFromServer: true,
        }),
      ).toEqual({ kind: "up-to-date", checkedAt: "2026-10-31T12:00:00.000Z" });
    });

    it("is unknown before an answer, after a failed lookup, or for a stale answer", () => {
      const config = serverConfig("0.0.35");
      expect(
        resolveServerReleaseStatus({ serverConfig: config, check: null, bundleFromServer: false }),
      ).toEqual({ kind: "unknown" });
      expect(
        resolveServerReleaseStatus({
          serverConfig: config,
          check: check("0.0.35", null),
          bundleFromServer: false,
        }),
      ).toEqual({ kind: "unknown" });
      // Answered before the server restarted on 0.0.35.
      expect(
        resolveServerReleaseStatus({
          serverConfig: config,
          check: check("0.0.34", "0.0.35"),
          bundleFromServer: false,
        }),
      ).toEqual({ kind: "unknown" });
    });

    it("asks for a reload when the serving server is ahead of this bundle", () => {
      const status = resolveServerReleaseStatus({
        serverConfig: serverConfig("0.0.35"),
        check: check("0.0.35", "0.0.35"),
        bundleFromServer: true,
      });
      expect(status).toEqual({ kind: "reload-needed", serverVersion: "0.0.35" });
    });

    it("does not ask for a reload when another origin served this bundle", () => {
      expect(
        resolveServerReleaseStatus({
          serverConfig: serverConfig("0.0.35"),
          check: check("0.0.35", "0.0.35"),
          bundleFromServer: false,
        }),
      ).toEqual({ kind: "up-to-date", checkedAt: "2026-10-31T12:00:00.000Z" });
    });

    it("does not ask for a reload for a nightly sharing this bundle's release", () => {
      expect(
        resolveServerReleaseStatus({
          serverConfig: serverConfig("0.0.34-nightly.20260728.931"),
          check: check("0.0.34-nightly.20260728.931", "0.0.34-nightly.20260728.931"),
          bundleFromServer: true,
        }).kind,
      ).toBe("up-to-date");
    });
  });
});
