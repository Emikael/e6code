import { useCallback, useEffect, useMemo, useRef } from "react";

import { EnvironmentProject, EnvironmentThreadShell } from "@e6tools/client-runtime/state/shell";
import type { AtomCommandResult } from "@e6tools/client-runtime/state/runtime";
import {
  type GitActionRequestInput,
  type VcsActionOperation,
  type VcsRef,
} from "@e6tools/client-runtime/state/vcs";
import type { GitRunStackedActionResult, ThreadWorkspaceSelection } from "@e6tools/contracts";
import {
  dedupeRemoteBranchesWithLocalMatches,
  sanitizeFeatureBranchName,
} from "@e6tools/shared/git";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";

import { useBranches } from "../state/queries";
import { threadEnvironment, environmentThreadShells } from "../state/threads";
import { waitForThreadWorkspaceOperation } from "./thread-workspace-operation";
import { vcsActionManager, vcsEnvironment } from "../state/vcs";
import { uuidv4 } from "../lib/uuid";
import { appAtomRegistry } from "./atom-registry";
import { setPendingConnectionError } from "./use-remote-environment-registry";
import { useAtomCommand } from "./use-atom-command";
import { showGitActionResult } from "./use-vcs-action-state";
import { useThreadSelection } from "./use-thread-selection";
import { useSelectedThreadWorktree } from "./use-selected-thread-worktree";

export function useSelectedThreadGitActions() {
  const selectWorkspace = useAtomCommand(threadEnvironment.selectWorkspace, {
    reportFailure: false,
  });
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const pull = useAtomCommand(vcsEnvironment.pull, { reportFailure: false });
  const { selectedThread, selectedThreadProject, selectedEnvironmentRuntime } =
    useThreadSelection();
  const selectionRef = useRef(selectedThread);
  selectionRef.current = selectedThread;
  const { selectedThreadCwd } = useSelectedThreadWorktree();
  const runStackedAction = useAtomCommand(
    vcsActionManager.runStackedAction({
      environmentId: selectedThread?.environmentId ?? null,
      cwd: selectedThreadCwd,
    }),
    { reportFailure: false },
  );

  const selectedThreadGitRootCwd = selectedThreadProject?.workspaceRoot ?? null;
  const branchTarget = useMemo(
    () => ({
      environmentId: selectedThread?.environmentId ?? null,
      cwd: selectedThreadGitRootCwd,
      query: null,
    }),
    [selectedThread?.environmentId, selectedThreadGitRootCwd],
  );
  const branchState = useBranches(branchTarget);
  const refreshSelectedThreadGitStatus = useCallback(
    async (options?: { readonly quiet?: boolean; readonly cwd?: string | null }) => {
      if (!selectedThread || !selectedThreadProject) {
        return null;
      }

      const cwd = options?.cwd ?? selectedThreadCwd;
      if (!cwd) {
        return null;
      }

      const target = { environmentId: selectedThread.environmentId, cwd };
      const execute = () =>
        refreshStatus({
          environmentId: selectedThread.environmentId,
          input: { cwd },
        });
      const result = options?.quiet
        ? await execute()
        : await vcsActionManager.track(
            appAtomRegistry,
            target,
            {
              operation: "refresh_status",
              label: "Refreshing source control status",
            },
            execute,
          );
      if (AsyncResult.isFailure(result)) {
        const error = Cause.squash(result.cause);
        const message = error instanceof Error ? error.message : "Failed to refresh git status.";
        setPendingConnectionError(message);
        return null;
      }
      setPendingConnectionError(null);
      return result.value;
    },
    [refreshStatus, selectedThread, selectedThreadCwd, selectedThreadProject],
  );

  useEffect(() => {
    if (!selectedThread || !selectedThreadProject) {
      return;
    }
    void refreshSelectedThreadGitStatus({ quiet: true });
  }, [refreshSelectedThreadGitStatus, selectedThread, selectedThreadProject]);

  const runSelectedThreadGitMutation = useCallback(
    async <T, E>(
      operation: VcsActionOperation,
      label: string,
      execute: (input: {
        readonly thread: EnvironmentThreadShell;
        readonly project: EnvironmentProject;
        readonly cwd: string;
      }) => Promise<AtomCommandResult<T, E>>,
      options?: { readonly managedExternally?: boolean },
    ): Promise<T | null> => {
      if (!selectedThread || !selectedThreadProject || !selectedThreadCwd) {
        return null;
      }

      const target = {
        environmentId: selectedThread.environmentId,
        cwd: selectedThreadCwd,
      };
      setPendingConnectionError(null);
      const run = () =>
        execute({
          thread: selectedThread,
          project: selectedThreadProject,
          cwd: selectedThreadCwd,
        });
      const result =
        options?.managedExternally === true
          ? await run()
          : await vcsActionManager.track(appAtomRegistry, target, { operation, label }, run);
      if (AsyncResult.isFailure(result)) {
        const error = Cause.squash(result.cause);
        const message = error instanceof Error ? error.message : "Git action failed.";
        if (
          selectionRef.current?.environmentId === selectedThread.environmentId &&
          selectionRef.current?.id === selectedThread.id
        ) {
          setPendingConnectionError(message);
          showGitActionResult({ type: "error", title: "Git action failed", description: message });
        }
        return null;
      }
      return result.value;
    },
    [selectedThread, selectedThreadCwd, selectedThreadProject],
  );

  const refreshSelectedThreadBranches = useCallback(async (): Promise<ReadonlyArray<VcsRef>> => {
    branchState.refresh();
    return dedupeRemoteBranchesWithLocalMatches(branchState.data?.refs ?? []).filter(
      (branch) => !branch.isRemote,
    );
  }, [branchState]);

  const onSelectSelectedThreadWorkspace = useCallback(
    async (selection: ThreadWorkspaceSelection) => {
      return runSelectedThreadGitMutation(
        "switch_ref",
        "Selecting workspace",
        async ({ thread }) => {
          if (
            selectedEnvironmentRuntime?.serverConfig?.environment.capabilities
              .threadWorkspaceSelection !== true
          ) {
            return AsyncResult.failure(
              Cause.fail(
                new Error(
                  "This server does not support independent thread workspaces. Update the server to select one.",
                ),
              ),
            );
          }
          const atom = environmentThreadShells.threadShellAtom({
            environmentId: thread.environmentId,
            threadId: thread.id,
          });
          const current = appAtomRegistry.get(atom) ?? thread;
          const generation = current.workspaceGeneration ?? 0;
          const result = await selectWorkspace({
            environmentId: thread.environmentId,
            input: {
              threadId: thread.id,
              expectedWorkspace: {
                generation,
                branch: current.branch,
                worktreePath: current.worktreePath,
              },
              selection,
            },
          });
          if (AsyncResult.isFailure(result)) return result;
          const completed = await waitForThreadWorkspaceOperation({
            registry: appAtomRegistry,
            atom,
            commandId: result.value.commandId,
            expectedGeneration: generation,
          });
          branchState.refresh();
          return completed;
        },
      );
    },
    [
      branchState,
      runSelectedThreadGitMutation,
      selectWorkspace,
      selectedEnvironmentRuntime?.serverConfig,
    ],
  );

  const onCheckoutSelectedThreadBranch = useCallback(
    (branch: string) => {
      const ref = branchState.data?.refs.find(
        (candidate) => candidate.name === branch && !candidate.isRemote,
      );
      return onSelectSelectedThreadWorkspace(
        ref?.worktreePath
          ? { kind: "attach", worktreePath: ref.worktreePath, branch }
          : { kind: "branch", branch },
      );
    },
    [branchState.data?.refs, onSelectSelectedThreadWorkspace],
  );

  const onCreateSelectedThreadBranch = useCallback(
    (branch: string) =>
      onSelectSelectedThreadWorkspace({
        kind: "create-branch",
        branch: sanitizeFeatureBranchName(branch),
        baseRef: selectedThread?.branch ?? "HEAD",
      }),
    [onSelectSelectedThreadWorkspace, selectedThread?.branch],
  );

  const onCreateSelectedThreadWorktree = useCallback(
    (nextWorktree: { readonly baseBranch: string; readonly newBranch: string }) =>
      onSelectSelectedThreadWorkspace({
        kind: "new-worktree",
        baseRef: nextWorktree.baseBranch,
        branch: sanitizeFeatureBranchName(nextWorktree.newBranch),
      }),
    [onSelectSelectedThreadWorkspace],
  );

  const onUseProjectCheckout = useCallback(
    () => onSelectSelectedThreadWorkspace({ kind: "local" }),
    [onSelectSelectedThreadWorkspace],
  );

  const onPullSelectedThreadBranch = useCallback(async () => {
    await runSelectedThreadGitMutation(
      "pull",
      "Pulling latest changes",
      async ({ thread, cwd }) => {
        const result = await pull({
          environmentId: thread.environmentId,
          input: { cwd },
        });
        if (AsyncResult.isFailure(result)) {
          return result;
        }
        await refreshSelectedThreadGitStatus({ quiet: true, cwd });
        showGitActionResult({
          type: "success",
          title:
            result.value.status === "skipped_up_to_date"
              ? "Already up to date"
              : `Pulled latest on ${result.value.refName}`,
        });
        return result;
      },
    );
  }, [pull, refreshSelectedThreadGitStatus, runSelectedThreadGitMutation]);

  const onRunSelectedThreadGitAction = useCallback(
    async (input: GitActionRequestInput): Promise<GitRunStackedActionResult | null> => {
      const actionId = uuidv4();
      return await runSelectedThreadGitMutation(
        "run_change_request",
        "Running source control action",
        async ({ thread, cwd }) => {
          const result = await runStackedAction({
            actionId,
            action: input.action,
            ...(input.commitMessage ? { commitMessage: input.commitMessage } : {}),
            ...(input.featureBranch ? { featureBranch: input.featureBranch } : {}),
            ...(input.filePaths?.length ? { filePaths: [...input.filePaths] } : {}),
            // A pull request the action opens is linked to the thread it ran beside.
            threadId: thread.id,
          });
          if (AsyncResult.isFailure(result)) {
            return result;
          }

          showGitActionResult({
            type: "success",
            title: result.value.toast.title,
            description: result.value.toast.description,
            prUrl:
              result.value.toast.cta.kind === "open_pr" ? result.value.toast.cta.url : undefined,
          });

          branchState.refresh();
          await refreshSelectedThreadGitStatus({ quiet: true, cwd });
          return result;
        },
        { managedExternally: true },
      );
    },
    [runStackedAction, refreshSelectedThreadGitStatus, runSelectedThreadGitMutation, branchState],
  );

  return {
    refreshSelectedThreadGitStatus,
    refreshSelectedThreadBranches,
    onCheckoutSelectedThreadBranch,
    onCreateSelectedThreadBranch,
    onCreateSelectedThreadWorktree,
    onUseProjectCheckout,
    onPullSelectedThreadBranch,
    onRunSelectedThreadGitAction,
  };
}
