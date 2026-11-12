import {
  PROVIDER_DISPLAY_NAMES,
  type ProviderDriverKind,
  type ScopedThreadRef,
} from "@e6tools/contracts";
import { useMemo } from "react";

import { resolveDiffPathForWorkspace } from "~/diffFileActions";
import { useProject, useThread } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { vcsEnvironment } from "~/state/vcs";

import {
  deletedThreadFilePaths,
  mergeThreadChangedFiles,
  type ThreadChangedFile,
} from "./threadChangedFiles";

export interface ThreadFilesContext {
  /** Files this thread has touched, by workspace path. */
  readonly changed: ReadonlyArray<ThreadChangedFile>;
  /** Workspace paths the latest turn changed. */
  readonly latestTurnPaths: ReadonlySet<string>;
  /** The thread's provider, "Claude"; "The agent" when unknown. */
  readonly agentName: string;
  /** Changes when a turn starts, so edit history scoped to a turn can be dropped. */
  readonly turnKey: string | null;
  /** Workspace paths the thread's changes leave deleted, so their edit history can go. */
  readonly deleted: ReadonlyArray<string>;
}

/**
 * What the Files tab needs from the thread beside it: the working tree (the same status query the
 * thread already holds, so no second request) and the thread's checkpoints, mapped into the
 * workspace the tab browses.
 */
export function useThreadFilesContext(threadRef: ScopedThreadRef, cwd: string): ThreadFilesContext {
  const thread = useThread(threadRef, { waitForShell: true });
  const project = useProject(
    thread ? { environmentId: thread.environmentId, projectId: thread.projectId } : null,
  );
  const statusCwd = thread?.worktreePath ?? (cwd.length > 0 ? cwd : null);
  const status = useEnvironmentQuery(
    statusCwd === null
      ? null
      : vcsEnvironment.status({
          environmentId: threadRef.environmentId,
          input: { cwd: statusCwd },
        }),
  );
  const repositoryRoot = thread?.worktreePath ? undefined : project?.repositoryIdentity?.rootPath;
  const workingTree = status.data?.workingTree.files;
  const checkpoints = thread?.checkpoints;
  const providerName = thread?.session?.providerName;
  const turnKey = thread?.latestTurn?.turnId ?? null;
  return useMemo(() => {
    const toWorkspacePath = (path: string) =>
      resolveDiffPathForWorkspace({ filePath: path, workspaceRoot: cwd, repositoryRoot });
    const latest = checkpoints?.at(-1);
    const changes = {
      workingTree: workingTree ?? [],
      checkpoints: checkpoints ?? [],
      toWorkspacePath,
    };
    return {
      changed: mergeThreadChangedFiles(changes),
      deleted: deletedThreadFilePaths(changes),
      latestTurnPaths: new Set(
        (latest?.files ?? []).flatMap((file) => toWorkspacePath(file.path) ?? []),
      ),
      agentName:
        (providerName ? PROVIDER_DISPLAY_NAMES[providerName as ProviderDriverKind] : null) ??
        "The agent",
      turnKey,
    };
  }, [checkpoints, cwd, providerName, repositoryRoot, turnKey, workingTree]);
}
