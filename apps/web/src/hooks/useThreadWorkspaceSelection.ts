import { CommandId, type ThreadWorkspaceSelection } from "@e6tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@e6tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@e6tools/client-runtime/state/runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ThreadShell } from "../types";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { randomUUID } from "../lib/utils";
import { stackedThreadToast, toastManager } from "../components/ui/toast";

interface WorkspaceRequest {
  environmentId: ThreadShell["environmentId"];
  input: {
    commandId: CommandId;
    threadId: ThreadShell["id"];
    expectedWorkspace: { generation: number; branch: string | null; worktreePath: string | null };
    selection: ThreadWorkspaceSelection;
  };
  interrupted?: boolean;
}

export function useThreadWorkspaceSelection(input: {
  thread: ThreadShell | null;
  supportsSelection: boolean;
}) {
  const dispatch = useAtomCommand(threadEnvironment.selectWorkspace, { reportFailure: false });
  const [requests, setRequests] = useState<ReadonlyMap<string, WorkspaceRequest>>(new Map());
  const requestsRef = useRef(requests);
  const changeRequest = useCallback(
    (key: string, request: WorkspaceRequest | null, commandId?: CommandId) => {
      const previous = requestsRef.current;
      if (commandId && previous.get(key)?.input.commandId !== commandId) return;
      const next = new Map(previous);
      if (request) next.set(key, request);
      else next.delete(key);
      requestsRef.current = next;
      setRequests(next);
    },
    [],
  );
  const threadKey = input.thread
    ? scopedThreadKey(scopeThreadRef(input.thread.environmentId, input.thread.id))
    : null;
  const operation = input.thread?.workspaceOperation;
  useEffect(() => {
    if (!threadKey || !operation || operation.status === "pending") return;
    const request = requestsRef.current.get(threadKey);
    if (request?.input.commandId !== operation.commandId) return;
    changeRequest(threadKey, null, operation.commandId);
    if (operation.status === "failed") {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not change the thread workspace",
          description: operation.error,
        }),
      );
    }
  }, [changeRequest, operation, threadKey]);
  const runRequest = useCallback(
    async (key: string, request: WorkspaceRequest) => {
      const result = await dispatch(request);
      if (result._tag === "Success") return;
      if (isAtomCommandInterrupted(result)) {
        changeRequest(key, { ...request, interrupted: true }, request.input.commandId);
        return;
      }
      changeRequest(key, null, request.input.commandId);
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not change the thread workspace",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
    [changeRequest, dispatch],
  );
  const selectWorkspace = useCallback(
    async (selection: ThreadWorkspaceSelection) => {
      if (
        !input.thread ||
        !threadKey ||
        requestsRef.current.has(threadKey) ||
        operation?.status === "pending"
      )
        return;
      if (!input.supportsSelection) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Workspace selection unavailable",
            description: "Update this environment's E6 Code server to select a thread workspace.",
          }),
        );
        return;
      }
      const request: WorkspaceRequest = {
        environmentId: input.thread.environmentId,
        input: {
          commandId: CommandId.make(randomUUID()),
          threadId: input.thread.id,
          expectedWorkspace: {
            generation: input.thread.workspaceGeneration ?? 0,
            branch: input.thread.branch,
            worktreePath: input.thread.worktreePath,
          },
          selection,
        },
      };
      changeRequest(threadKey, request);
      await runRequest(threadKey, request);
    },
    [
      changeRequest,
      input.supportsSelection,
      input.thread,
      operation?.status,
      runRequest,
      threadKey,
    ],
  );
  const retryWorkspaceSelection = useCallback(async () => {
    if (!threadKey) return;
    const request = requestsRef.current.get(threadKey);
    if (!request?.interrupted) return;
    const retry = { ...request, interrupted: false };
    changeRequest(threadKey, retry, request.input.commandId);
    await runRequest(threadKey, retry);
  }, [changeRequest, runRequest, threadKey]);
  return {
    selectWorkspace,
    retryWorkspaceSelection,
    interrupted: threadKey !== null && requests.get(threadKey)?.interrupted === true,
    pending: (threadKey !== null && requests.has(threadKey)) || operation?.status === "pending",
  };
}
