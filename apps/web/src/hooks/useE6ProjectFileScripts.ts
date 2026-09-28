import {
  LEGACY_E6_PROJECT_FILE_NAME,
  E6_PROJECT_FILE_NAME,
  type EnvironmentId,
  type E6ProjectFile,
  type E6ProjectFileScript,
} from "@e6tools/contracts";
import { parseE6ProjectFile } from "@e6tools/shared/e6ProjectFile";
import { useMemo } from "react";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const NO_SCRIPTS: ReadonlyArray<E6ProjectFileScript> = [];

export interface E6ProjectFileState {
  /**
   * - `valid`: e6.json exists and decoded.
   * - `invalid`: e6.json exists but fails to decode (the server then ignores
   *   the whole file, including `iconPath` and every script).
   * - `missing`: no readable e6.json at the workspace root.
   * - `loading`: the file query has not settled yet.
   */
  status: "loading" | "missing" | "invalid" | "valid";
  /** The decoded file when status is `valid`, null otherwise. */
  file: E6ProjectFile | null;
  scripts: ReadonlyArray<E6ProjectFileScript>;
}

/**
 * Decoded state of the project's checked-in `e6.json`, including whether the
 * file exists but is broken — which the runtime otherwise swallows silently.
 */
export function useE6ProjectFileState(
  environmentId: EnvironmentId,
  cwd: string | null,
): E6ProjectFileState {
  const primary = useProjectFileQuery(environmentId, cwd ?? "", E6_PROJECT_FILE_NAME, cwd !== null);
  const legacy = useProjectFileQuery(
    environmentId,
    cwd ?? "",
    LEGACY_E6_PROJECT_FILE_NAME,
    cwd !== null && !primary.isPending && primary.data == null,
  );
  const query = primary.data != null ? primary : legacy;
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  const isPending = primary.isPending || (primary.data == null && legacy.isPending);
  return useMemo(() => {
    if (contents === null) {
      return {
        status: isPending ? "loading" : "missing",
        file: null,
        scripts: NO_SCRIPTS,
      } as const;
    }
    const file = parseE6ProjectFile(contents);
    if (file === null) {
      return { status: "invalid", file: null, scripts: NO_SCRIPTS } as const;
    }
    return { status: "valid", file, scripts: file.scripts ?? NO_SCRIPTS } as const;
  }, [contents, isPending]);
}

/**
 * Scripts declared in the project's checked-in `e6.json`, offered in the
 * scripts menu for import. Missing, truncated, or invalid files resolve to
 * an empty list.
 */
export function useE6ProjectFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): ReadonlyArray<E6ProjectFileScript> {
  return useE6ProjectFileState(environmentId, cwd).scripts;
}
