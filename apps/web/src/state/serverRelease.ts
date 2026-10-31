import { useAtomValue } from "@effect/atom-react";

import { HOSTED_APP_CHANNEL } from "../branding";
import { readPrimaryEnvironmentTarget } from "../environments/primary";
import { resolveServerReleaseStatus, supportsServerUpdateCheck } from "../versionSkew";
import { usePrimaryEnvironmentId } from "./environments";
import { useEnvironmentQuery } from "./query";
import { primaryServerConfigAtom, serverEnvironment } from "./server";

/**
 * True when the primary server also served this page, so a reload picks up
 * the bundle of a newer server. Hosted builds and builds pointed at a
 * configured server URL are deployed separately.
 */
function readBundleFromPrimaryServer(): boolean {
  if (HOSTED_APP_CHANNEL !== null) return false;
  try {
    return readPrimaryEnvironmentTarget()?.source === "window-origin";
  } catch {
    return false;
  }
}

const bundleFromPrimaryServer = readBundleFromPrimaryServer();

/**
 * Release status of the primary server, the one an update from About
 * replaces. Shared by Settings → About and the sidebar so both read the same
 * cached query.
 */
export function usePrimaryServerRelease() {
  const environmentId = usePrimaryEnvironmentId();
  const serverConfig = useAtomValue(primaryServerConfigAtom);
  const supported = environmentId !== null && supportsServerUpdateCheck(serverConfig);
  const check = useEnvironmentQuery(
    supported ? serverEnvironment.checkForUpdate({ environmentId, input: {} }) : null,
  );
  const updateState = useAtomValue(serverEnvironment.updateStateAtom(environmentId));
  const status = resolveServerReleaseStatus({
    serverConfig,
    check: check.data,
    bundleFromServer: bundleFromPrimaryServer,
  });
  // An answer for another server version is being replaced: the query asks
  // again when the version changes.
  const isStale =
    check.data !== null &&
    check.error === null &&
    check.data.currentVersion !== serverConfig?.environment.serverVersion;
  return {
    environmentId,
    serverConfig,
    status,
    isChecking: supported && (check.isPending || isStale),
    updateState,
  };
}
