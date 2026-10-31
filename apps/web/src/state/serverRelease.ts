import { useAtomValue } from "@effect/atom-react";

import { HOSTED_APP_CHANNEL } from "../branding";
import { resolveServerReleaseStatus, supportsServerUpdateCheck } from "../versionSkew";
import { usePrimaryEnvironment } from "./environments";
import { useEnvironmentQuery } from "./query";
import { serverEnvironment } from "./server";

/**
 * Release status of the primary server, the one that serves this bundle and
 * is what "update" replaces. Shared by Settings → About and the sidebar so
 * both read the same cached query.
 */
export function usePrimaryServerRelease() {
  const environment = usePrimaryEnvironment();
  const environmentId = environment?.environmentId ?? null;
  const serverConfig = environment?.serverConfig ?? null;
  const supported = environmentId !== null && supportsServerUpdateCheck(serverConfig);
  const check = useEnvironmentQuery(
    supported ? serverEnvironment.checkForUpdate({ environmentId, input: {} }) : null,
  );
  const updateState = useAtomValue(serverEnvironment.updateStateAtom(environmentId));
  const status = resolveServerReleaseStatus({
    serverConfig,
    check: check.data,
    // Hosted builds are deployed separately, so reloading cannot pick up a
    // newer server's bundle.
    bundleFromServer: HOSTED_APP_CHANNEL === null,
  });
  return {
    environment,
    environmentId,
    serverConfig,
    status,
    isLoading: check.isPending && check.data === null,
    updateState,
  };
}
