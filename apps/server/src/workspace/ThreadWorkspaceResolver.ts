import {
  type CommandId,
  type ProjectId,
  type ThreadId,
  type ThreadWorkspaceSelection,
  type ThreadWorkspaceProvenance,
} from "@e6tools/contracts";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ServerConfig } from "../config.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import { CheckpointStore } from "../checkpointing/CheckpointStore.ts";
import { checkpointRefForThreadTurn } from "../checkpointing/Utils.ts";
import { withWorkspaceLease } from "./workspaceLease.ts";

export class ThreadWorkspacePreparationError extends Schema.TaggedError<ThreadWorkspacePreparationError>()(
  "ThreadWorkspacePreparationError",
  { message: Schema.String },
) {}

export const prepareThreadWorkspace = Effect.fn("prepareThreadWorkspace")(function* (input: {
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly commandId: CommandId;
  readonly projectCwd: string;
  readonly selection: ThreadWorkspaceSelection;
  readonly generation: number;
  readonly checkpointTurnCount: number;
}) {
  const git = yield* GitVcsDriver;
  const workflow = yield* GitWorkflowService;
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const checkpointStore = yield* CheckpointStore;
  const fail = (message: string) => new ThreadWorkspacePreparationError({ message });
  if (!(yield* fs.exists(input.projectCwd)))
    return yield* fail("missing workspace: project checkout no longer exists");
  if (!(yield* workflow.isRepository(input.projectCwd)))
    return yield* fail(
      "unsupported operation: thread workspace selection requires a Git repository",
    );
  const commonDir = Effect.fnUntraced(function* (cwd: string) {
    const result = yield* git.execute({
      operation: "threadWorkspace.repositoryIdentity",
      cwd,
      args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    });
    return yield* fs.realPath(result.stdout.trim());
  });
  const repositoryRoot = yield* commonDir(input.projectCwd);
  return yield* withWorkspaceLease(
    repositoryRoot,
    Effect.gen(function* () {
      const selection = input.selection;
      let cwd: string;
      let expectedBranch: string | undefined;
      // The shared project checkout persists as worktreePath null.
      let sharedProjectCheckout = selection.kind === "local";
      if (selection.kind === "local" || selection.kind === "attach") {
        cwd = yield* fs
          .realPath(selection.kind === "local" ? input.projectCwd : selection.worktreePath)
          .pipe(
            Effect.mapError(() =>
              fail("missing workspace: the selected checkout no longer exists"),
            ),
          );
        expectedBranch = selection.branch;
      } else {
        const projectOnBranch =
          selection.kind === "branch" &&
          (yield* workflow.localStatus({ cwd: input.projectCwd })).refName === selection.branch;
        if (projectOnBranch) {
          // No isolation needed and nothing to mutate: the project checkout
          // already is the requested branch. Use it instead of failing on
          // the occupied branch.
          cwd = yield* fs.realPath(input.projectCwd);
          expectedBranch = selection.branch;
          sharedProjectCheckout = true;
        } else {
          cwd = path.join(
            config.worktreesDir,
            "threads",
            Encoding.encodeBase64Url(input.projectId),
            Encoding.encodeBase64Url(input.threadId),
            Encoding.encodeBase64Url(input.commandId),
          );
          const newBranch =
            selection.kind === "create-branch"
              ? selection.branch
              : selection.kind === "new-worktree"
                ? (selection.branch ??
                  `e6/thread-${Encoding.encodeBase64Url(input.threadId)}-${Encoding.encodeBase64Url(input.commandId)}`)
                : undefined;
          let refName = selection.kind === "branch" ? selection.branch : selection.baseRef;
          expectedBranch = newBranch ?? refName;
          if (
            selection.kind === "new-worktree" &&
            selection.startFromOrigin === true &&
            (yield* workflow.remoteBranchExists({
              cwd: input.projectCwd,
              remoteName: "origin",
              refName,
            }))
          ) {
            yield* workflow.fetchRemote({ cwd: input.projectCwd, remoteName: "origin", refName });
            refName = `origin/${refName}`;
          }
          if (!(yield* fs.exists(cwd))) {
            yield* fs.makeDirectory(path.dirname(cwd), { recursive: true });
            yield* workflow
              .createWorktree({
                cwd: input.projectCwd,
                refName,
                path: cwd,
                ...(newBranch ? { newRefName: newBranch } : {}),
              })
              .pipe(
                Effect.mapError((error) =>
                  fail(
                    `Workspace preparation failed: ${error.message}. If the branch is already checked out, attach that existing workspace or create a distinct branch.`,
                  ),
                ),
              );
          }
          cwd = yield* fs.realPath(cwd);
        }
      }
      if ((yield* commonDir(cwd)) !== repositoryRoot)
        return yield* fail("wrong repository: selected workspace belongs to another repository");
      const status = yield* workflow.localStatus({ cwd });
      if (expectedBranch !== undefined && status.refName !== expectedBranch)
        return yield* fail(
          `stale branch: selected checkout is on ${status.refName ?? "detached HEAD"}, expected ${expectedBranch}`,
        );
      const workspaceProvenance: ThreadWorkspaceProvenance = {
        generation: input.generation,
        cwd,
        repositoryRoot,
      };
      const initialBaseline = checkpointRefForThreadTurn(input.threadId, 0, input.generation);
      if (!(yield* checkpointStore.hasCheckpointRef({ cwd, checkpointRef: initialBaseline })))
        yield* checkpointStore.captureCheckpoint({ cwd, checkpointRef: initialBaseline });
      const baseline = checkpointRefForThreadTurn(
        input.threadId,
        input.checkpointTurnCount,
        input.generation,
      );
      if (!(yield* checkpointStore.hasCheckpointRef({ cwd, checkpointRef: baseline })))
        yield* checkpointStore.captureCheckpoint({ cwd, checkpointRef: baseline });
      return {
        branch: status.refName,
        worktreePath: sharedProjectCheckout ? null : cwd,
        workspaceGeneration: input.generation,
        workspaceProvenance,
      };
    }),
  );
});
