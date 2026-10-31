import type {
  EnvironmentId,
  ServerConfig,
  ServerSelfUpdateCapability,
  ServerUpdateCheckResult,
} from "@e6tools/contracts";
import type { ServerUpdateState } from "@e6tools/client-runtime/state/server";
import { NPM_LAUNCHER_PACKAGE_NAME } from "@e6tools/shared/brand";
import { cliReleaseChannelOf } from "@e6tools/shared/cliRelease";
import { compareSemverVersions, parseSemver } from "@e6tools/shared/semver";
import * as Schema from "effect/Schema";

import { APP_VERSION } from "./branding";
import { getLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";

export interface VersionMismatch {
  readonly clientVersion: string;
  readonly serverVersion: string;
  readonly hint: string;
}

const VERSION_MISMATCH_DISMISSALS_STORAGE_KEY = "e6code:version-mismatch-dismissals:v1";

// Runtime failures retain their identity until the next attempt. Dismiss only
// that attempt, across chat remounts, without clearing the error in Settings.
const dismissedServerUpdateFailures = new WeakSet<ServerUpdateState>();

export function isServerUpdateFailureDismissed(state: ServerUpdateState): boolean {
  return state.status === "failed" && dismissedServerUpdateFailures.has(state);
}

export function dismissServerUpdateFailure(state: ServerUpdateState): void {
  if (state.status === "failed") dismissedServerUpdateFailures.add(state);
}

const VersionMismatchDismissalsSchema = Schema.Struct({
  keys: Schema.Array(Schema.String),
});

type VersionMismatchDismissals = typeof VersionMismatchDismissalsSchema.Type;

function normalizeVersion(version: string | null | undefined): string | null {
  const trimmed = version?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

/** Core `major.minor.patch`, dropping any prerelease or build suffix. */
function versionCore(version: string): string {
  return version.replace(/[-+].*$/, "");
}

/**
 * Orders two E6 Code versions by the skew rules below, or null when either
 * does not parse as semver.
 *
 * Two nightly builds compare their full versions, including the date and run.
 * Other combinations compare their core `major.minor.patch` only, so a stable
 * build and a nightly build with the same core compare as equal.
 */
function compareReleaseVersions(left: string, right: string): number | null {
  const leftCore = versionCore(left);
  const rightCore = versionCore(right);
  if (!parseSemver(leftCore) || !parseSemver(rightCore)) return null;
  const compareNightlyBuilds =
    parseSemver(left)?.prerelease[0] === "nightly" &&
    parseSemver(right)?.prerelease[0] === "nightly";
  return compareNightlyBuilds
    ? compareSemverVersions(left, right)
    : compareSemverVersions(leftCore, rightCore);
}

/**
 * The skew a user can act on: the connected server runs an older E6 Code than
 * this client, so the server is the side that needs updating. A server ahead
 * of the client does not need an update. Versions that do not parse as semver
 * fall back to plain string inequality.
 */
export function resolveVersionMismatch(
  serverVersion: string | null | undefined,
): VersionMismatch | null {
  const normalizedClientVersion = normalizeVersion(APP_VERSION);
  const normalizedServerVersion = normalizeVersion(serverVersion);
  if (!normalizedClientVersion || !normalizedServerVersion) {
    return null;
  }

  const order = compareReleaseVersions(normalizedServerVersion, normalizedClientVersion);
  const serverIsBehind =
    order === null ? normalizedServerVersion !== normalizedClientVersion : order < 0;
  if (!serverIsBehind) {
    return null;
  }

  return {
    clientVersion: normalizedClientVersion,
    serverVersion: normalizedServerVersion,
    hint: "Version mismatch. Try syncing the client and server to the same E6 Code version.",
  };
}

export function resolveServerConfigVersionMismatch(
  serverConfig: Pick<ServerConfig, "environment"> | null | undefined,
): VersionMismatch | null {
  return resolveVersionMismatch(serverConfig?.environment.serverVersion);
}

/** The update path the connected server offers, or null when it only
    supports a manual relaunch (older servers, dev checkouts, Windows). */
export function resolveServerSelfUpdateCapability(
  serverConfig: Pick<ServerConfig, "environment"> | null | undefined,
): ServerSelfUpdateCapability | null {
  return serverConfig?.environment.capabilities.serverSelfUpdate ?? null;
}

/** True when the desktop app supervising this server can be told to update
    itself over RPC. Older desktop servers only get the manual instruction. */
export function supportsDesktopAppUpdate(
  serverConfig: Pick<ServerConfig, "environment"> | null | undefined,
): boolean {
  return serverConfig?.environment.capabilities.desktopAppUpdate === true;
}

/** True when the connected server can recover opted-in running turns after
    its self-update restart. */
export function supportsServerUpdateThreadContinuation(
  serverConfig: Pick<ServerConfig, "environment"> | null | undefined,
): boolean {
  return serverConfig?.environment.capabilities.serverUpdateThreadContinuation === true;
}

/** True when the connected server can report its newest published release. */
export function supportsServerUpdateCheck(
  serverConfig: Pick<ServerConfig, "environment"> | null | undefined,
): boolean {
  return serverConfig?.environment.capabilities.serverUpdateCheck === true;
}

export type ServerReleaseStatus =
  | { readonly kind: "unsupported" }
  | { readonly kind: "unknown" }
  | { readonly kind: "up-to-date"; readonly checkedAt: string | null }
  | { readonly kind: "available"; readonly targetVersion: string }
  | { readonly kind: "reload-needed"; readonly serverVersion: string };

/**
 * Where the primary server stands against the newest published release.
 * Preview servers report as unsupported.
 *
 * `bundleFromServer` says this page was served by that server, so a server
 * ahead of the running bundle (typically right after an update) only needs a
 * reload. A check answered for a different server version than the current
 * one is stale and reads as unknown until the query refreshes.
 */
export function resolveServerReleaseStatus(input: {
  readonly serverConfig: Pick<ServerConfig, "environment"> | null | undefined;
  readonly check: ServerUpdateCheckResult | null;
  readonly bundleFromServer: boolean;
}): ServerReleaseStatus {
  const serverVersion = normalizeVersion(input.serverConfig?.environment.serverVersion);
  if (
    !serverVersion ||
    !supportsServerUpdateCheck(input.serverConfig) ||
    // Preview builds have no release track to follow.
    cliReleaseChannelOf(serverVersion) === "preview"
  ) {
    return { kind: "unsupported" };
  }
  const clientVersion = normalizeVersion(APP_VERSION);
  if (input.bundleFromServer && clientVersion) {
    const order = compareReleaseVersions(serverVersion, clientVersion);
    if (order !== null && order > 0) return { kind: "reload-needed", serverVersion };
  }
  const { check } = input;
  if (check === null || check.latestVersion === null || check.currentVersion !== serverVersion) {
    return { kind: "unknown" };
  }
  return check.updateAvailable && check.latestVersion !== serverVersion
    ? { kind: "available", targetVersion: check.latestVersion }
    : { kind: "up-to-date", checkedAt: check.checkedAt };
}

/** The command to hand users whose server cannot update itself. */
export function manualServerUpdateCommand(targetVersion: string): string {
  return `npx ${NPM_LAUNCHER_PACKAGE_NAME}@${targetVersion}`;
}

export function serverUpdateGuidance(capability: ServerSelfUpdateCapability): string {
  return capability === "desktop-managed" ? "Update the desktop app" : "Update to stay in sync";
}

export function buildVersionMismatchDismissalKey(
  environmentId: EnvironmentId,
  mismatch: Pick<VersionMismatch, "clientVersion" | "serverVersion">,
): string {
  return `${environmentId}:${mismatch.clientVersion}:${mismatch.serverVersion}`;
}

function readVersionMismatchDismissals(): VersionMismatchDismissals {
  try {
    return (
      getLocalStorageItem(
        VERSION_MISMATCH_DISMISSALS_STORAGE_KEY,
        VersionMismatchDismissalsSchema,
      ) ?? { keys: [] }
    );
  } catch (error) {
    console.error("Could not read version-mismatch dismissals.", error);
    return { keys: [] };
  }
}

function writeVersionMismatchDismissals(document: VersionMismatchDismissals): void {
  try {
    setLocalStorageItem(
      VERSION_MISMATCH_DISMISSALS_STORAGE_KEY,
      document,
      VersionMismatchDismissalsSchema,
    );
  } catch (error) {
    console.error("Could not persist version-mismatch dismissals.", error);
  }
}

export function isVersionMismatchDismissed(dismissalKey: string | null | undefined): boolean {
  if (!dismissalKey) {
    return false;
  }
  return readVersionMismatchDismissals().keys.includes(dismissalKey);
}

export function dismissVersionMismatch(dismissalKey: string | null | undefined): void {
  if (!dismissalKey) {
    return;
  }
  const document = readVersionMismatchDismissals();
  if (document.keys.includes(dismissalKey)) {
    return;
  }
  writeVersionMismatchDismissals({
    keys: [...document.keys, dismissalKey],
  });
}
