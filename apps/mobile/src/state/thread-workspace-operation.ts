import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/shell";
import type { AtomCommandResult } from "@e6tools/client-runtime/state/runtime";
import type { CommandId } from "@e6tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, type Atom, type AtomRegistry } from "effect/unstable/reactivity";

export type ThreadWorkspaceSnapshot = Pick<
  EnvironmentThreadShell,
  "workspaceOperation" | "workspaceGeneration" | "branch" | "worktreePath"
>;

/** An ACK accepts the request. Only the matching projected operation confirms its workspace. */
export function waitForThreadWorkspaceOperation(input: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly atom: Atom.Atom<ThreadWorkspaceSnapshot | null>;
  readonly commandId: CommandId;
  readonly expectedGeneration: number;
}): Promise<AtomCommandResult<ThreadWorkspaceSnapshot, Error>> {
  return new Promise((resolve) => {
    let unsubscribe = () => {};
    let finished = false;
    const finish = (snapshot: ThreadWorkspaceSnapshot | null) => {
      if (snapshot === null) return;
      const operation = snapshot?.workspaceOperation;
      if (operation?.commandId === input.commandId && operation.status === "pending") return;
      if (
        operation?.commandId !== input.commandId &&
        snapshot !== null &&
        (snapshot.workspaceGeneration ?? 0) === input.expectedGeneration
      )
        return;
      finished = true;
      unsubscribe();
      resolve(
        snapshot && operation?.commandId === input.commandId && operation.status === "completed"
          ? AsyncResult.success(snapshot)
          : AsyncResult.failure(
              Cause.fail(
                new Error(
                  operation?.commandId === input.commandId
                    ? (operation.error ?? "The workspace could not be selected.")
                    : "The thread workspace changed before this selection could be confirmed.",
                ),
              ),
            ),
      );
    };
    unsubscribe = input.registry.subscribe(input.atom, finish);
    if (finished) unsubscribe();
    else finish(input.registry.get(input.atom));
  });
}
