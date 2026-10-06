import type { EnvironmentProject } from "@e6tools/client-runtime/state/shell";
import type { VcsRef } from "@e6tools/client-runtime/state/vcs";
import type { AtomCommandResult } from "@e6tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";

/** Save draft intent; the server prepares its checkout when the first turn starts. */
export function selectNewTaskBranch(input: {
  readonly branch: VcsRef;
  readonly project: Pick<EnvironmentProject, "environmentId" | "workspaceRoot"> | null;
}): AtomCommandResult<VcsRef, Error> {
  if (!input.project) {
    return AsyncResult.failure(
      Cause.fail(new Error("The selected project is unavailable. Reconnect and try again.")),
    );
  }
  return AsyncResult.success(input.branch);
}
