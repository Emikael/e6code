import {
  LEGACY_E6_PROJECT_FILE_NAME,
  E6_PROJECT_FILE_NAME,
  type EnvironmentId,
  type ThreadEnvMode,
} from "@e6tools/contracts";
import { parseE6ProjectFile } from "@e6tools/shared/e6ProjectFile";
import { executeAtomQuery } from "@e6tools/client-runtime/state/runtime";

import {
  getProjectFileQueryAtom,
  resolveProjectFileQueryData,
} from "~/components/files/projectFilesQueryState";
import { appAtomRegistry } from "~/rpc/atomRegistry";

/**
 * Read `defaultThreadEnvMode` from the project's checked-in `e6.json`.
 *
 * Imperative counterpart to `useE6ProjectFileScripts` for the new-thread
 * path, which resolves defaults at call time rather than render time. The
 * file query atom caches per (environment, cwd), so repeat calls don't
 * re-fetch. Optimistic in-app writes overlay the query result, matching what
 * `useProjectFileQuery` renders. Missing, truncated, or invalid files
 * resolve to null.
 */
export async function readE6ProjectFileDefaultThreadEnvMode(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): Promise<ThreadEnvMode | null> {
  const read = async (relativePath: string) => {
    const result = await executeAtomQuery(
      appAtomRegistry,
      getProjectFileQueryAtom(environmentId, workspaceRoot, relativePath),
      { reportDefect: false, reportFailure: false },
    );
    const data = resolveProjectFileQueryData(
      environmentId,
      workspaceRoot,
      relativePath,
      result._tag === "Success" ? result.value : null,
    );
    if (data === null || data.truncated) return null;
    return parseE6ProjectFile(data.contents)?.defaultThreadEnvMode ?? null;
  };
  return (await read(E6_PROJECT_FILE_NAME)) ?? (await read(LEGACY_E6_PROJECT_FILE_NAME));
}
