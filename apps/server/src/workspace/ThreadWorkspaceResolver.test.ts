// @effect-diagnostics nodeBuiltinImport:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  ProjectId,
  ThreadId,
  type ThreadWorkspaceSelection,
  type VcsStatusLocalResult,
} from "@e6tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { CheckpointStore } from "../checkpointing/CheckpointStore.ts";
import { ServerConfig } from "../config.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";
import { prepareThreadWorkspace } from "./ThreadWorkspaceResolver.ts";

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const process = yield* VcsProcess.VcsProcess;
    return yield* process.run({
      operation: "ThreadWorkspaceResolver.test.git",
      command: "git",
      cwd,
      args,
      timeoutMs: 30_000,
    });
  });

const gitText = (cwd: string, args: ReadonlyArray<string>) =>
  git(cwd, args).pipe(Effect.map((result) => result.stdout.trim()));

/**
 * The resolver drives Git through `GitWorkflowService`; back its real methods
 * with the real `git` CLI so the test exercises path derivation, branch
 * validation, isolation, and occupied-branch handling without the full
 * GitManager dependency graph.
 */
const gitWorkflowService = {
  isRepository: (cwd: string) =>
    gitText(cwd, ["rev-parse", "--is-inside-work-tree"]).pipe(
      Effect.map((output) => output === "true"),
      Effect.orElseSucceed(() => false),
    ),
  hasCommit: (input: { readonly cwd: string; readonly refName: string }) =>
    gitText(input.cwd, ["rev-parse", "--verify", `${input.refName}^{commit}`]).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    ),
  localStatus: (input: { readonly cwd: string }) =>
    gitText(input.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).pipe(
      Effect.map((refName): VcsStatusLocalResult => ({
        isRepo: true,
        hasPrimaryRemote: false,
        isDefaultRef: false,
        refName,
        hasWorkingTreeChanges: false,
        workingTree: { files: [], insertions: 0, deletions: 0 },
      })),
    ),
  remoteExists: () => Effect.succeed(false),
  remoteBranchExists: () => Effect.succeed(false),
  fetchRemote: () => Effect.void,
  createWorktree: (input: {
    readonly cwd: string;
    readonly refName: string;
    readonly path: string | null;
    readonly newRefName?: string | undefined;
  }) =>
    input.path === null
      ? Effect.die(new Error("test mock requires an explicit worktree path"))
      : Effect.gen(function* () {
          const target = input.path as string;
          if (input.newRefName === undefined) {
            yield* gitText(input.cwd, ["worktree", "add", target, input.refName]);
          } else {
            yield* gitText(input.cwd, [
              "worktree",
              "add",
              "-b",
              input.newRefName,
              target,
              input.refName,
            ]);
          }
          return { worktree: { path: target, refName: input.newRefName ?? input.refName } };
        }),
} as unknown as GitWorkflowService["Service"];

const GitWorkflowLive = Layer.succeed(GitWorkflowService, gitWorkflowService);

const CheckpointStoreStub = Layer.succeed(CheckpointStore, {
  hasCheckpointRef: () => Effect.succeed(false),
  captureCheckpoint: () => Effect.void,
} as unknown as CheckpointStore["Service"]);

const InfraLayer = Layer.mergeAll(
  VcsProcess.layer,
  WorkspacePaths.layer,
  ServerConfig.layerTest(process.cwd(), { prefix: "e6-thread-workspace-test-" }),
).pipe(Layer.provideMerge(NodeServices.layer));

const TestLayer = Layer.mergeAll(GitVcsDriver.layer, GitWorkflowLive, CheckpointStoreStub).pipe(
  Layer.provideMerge(InfraLayer),
);

const writeFile = (cwd: string, relativePath: string, contents: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const absolute = path.join(cwd, relativePath);
    yield* fs.makeDirectory(path.dirname(absolute), { recursive: true });
    yield* fs.writeFileString(absolute, contents);
  });

const makeRepo = Effect.fn(function* () {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "e6code-thread-workspace-" });
  yield* gitText(dir, ["init", "-b", "main"]);
  yield* gitText(dir, ["config", "user.email", "test@e6.dev"]);
  yield* gitText(dir, ["config", "user.name", "E6 Test"]);
  yield* writeFile(dir, "marker.txt", "root\n");
  yield* gitText(dir, ["add", "."]);
  yield* gitText(dir, ["commit", "-m", "init"]);
  yield* gitText(dir, ["branch", "feature-a"]);
  yield* gitText(dir, ["branch", "feature-b"]);
  return dir;
});

const prepare = (input: {
  readonly projectCwd: string;
  readonly threadId: string;
  readonly commandId: string;
  readonly selection: ThreadWorkspaceSelection;
  readonly generation?: number;
}) =>
  prepareThreadWorkspace({
    projectId: ProjectId.make("project-1"),
    threadId: ThreadId.make(input.threadId),
    commandId: CommandId.make(input.commandId),
    projectCwd: input.projectCwd,
    selection: input.selection,
    generation: input.generation ?? 1,
    checkpointTurnCount: 0,
  });

const failureMessage = (exit: Exit.Exit<unknown, unknown>): string => {
  if (Exit.isSuccess(exit)) return "";
  const reason = exit.cause.reasons.find((entry) => entry._tag === "Fail");
  if (reason === undefined || reason._tag !== "Fail") return "";
  const error: unknown = reason.error;
  return typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : "";
};

it.layer(TestLayer)("prepareThreadWorkspace", (it) => {
  it.effect("runs a local selection against the project checkout without a worktree", () =>
    Effect.gen(function* () {
      const repo = yield* makeRepo();
      const fs = yield* FileSystem.FileSystem;
      const result = yield* prepare({
        projectCwd: repo,
        threadId: "thread-local",
        commandId: "cmd-local",
        selection: { kind: "local", branch: "main" },
      });
      expect(result.worktreePath).toBe(null);
      expect(result.branch).toBe("main");
      expect(result.workspaceGeneration).toBe(1);
      expect(result.workspaceProvenance.cwd).toBe(yield* fs.realPath(repo));
    }),
  );

  it.effect("runs a branch selection for the checked-out branch in the project checkout", () =>
    Effect.gen(function* () {
      const repo = yield* makeRepo();
      const result = yield* prepare({
        projectCwd: repo,
        threadId: "thread-current",
        commandId: "cmd-current",
        selection: { kind: "branch", branch: "main" },
      });
      expect(result.worktreePath).toBe(null);
      expect(result.branch).toBe("main");
      expect(result.workspaceProvenance.cwd).toBe(
        yield* (yield* FileSystem.FileSystem).realPath(repo),
      );
      // No managed worktree is created for the already-checked-out branch.
      expect(yield* gitText(repo, ["worktree", "list", "--porcelain"])).not.toContain("worktrees");
    }),
  );

  it.effect("isolates two threads on different branches and preserves the first checkout", () =>
    Effect.gen(function* () {
      const repo = yield* makeRepo();
      const fs = yield* FileSystem.FileSystem;

      const a = yield* prepare({
        projectCwd: repo,
        threadId: "thread-a",
        commandId: "cmd-a",
        selection: { kind: "branch", branch: "feature-a" },
      });
      const b = yield* prepare({
        projectCwd: repo,
        threadId: "thread-b",
        commandId: "cmd-b",
        selection: { kind: "branch", branch: "feature-b" },
      });

      expect(a.worktreePath).not.toBe(null);
      expect(b.worktreePath).not.toBe(null);
      expect(a.worktreePath).not.toBe(b.worktreePath);
      expect(a.branch).toBe("feature-a");
      expect(b.branch).toBe("feature-b");

      // Dirty + staged work in thread A's checkout must survive thread B's selection.
      yield* writeFile(a.worktreePath!, "only-a.txt", "a\n");
      yield* writeFile(a.worktreePath!, "marker.txt", "a-dirty\n");
      yield* gitText(a.worktreePath!, ["add", "only-a.txt"]);
      const projectHeadBefore = yield* gitText(repo, ["rev-parse", "HEAD"]);
      const projectBranchBefore = yield* gitText(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);

      const b2 = yield* prepare({
        projectCwd: repo,
        threadId: "thread-b",
        commandId: "cmd-b",
        selection: { kind: "branch", branch: "feature-b" },
      });
      expect(b2.worktreePath).toBe(b.worktreePath);

      expect(yield* fs.exists(`${a.worktreePath!}/only-a.txt`)).toBe(true);
      const aStatus = yield* gitText(a.worktreePath!, ["status", "--porcelain"]);
      expect(aStatus).toContain("only-a.txt");
      expect(aStatus).toContain("marker.txt");
      expect(yield* gitText(a.worktreePath!, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
        "feature-a",
      );
      expect(yield* gitText(repo, ["rev-parse", "HEAD"])).toBe(projectHeadBefore);
      expect(yield* gitText(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(projectBranchBefore);
    }),
  );

  it.effect("is idempotent for a repeated command id", () =>
    Effect.gen(function* () {
      const repo = yield* makeRepo();
      const first = yield* prepare({
        projectCwd: repo,
        threadId: "thread-retry",
        commandId: "cmd-retry",
        selection: { kind: "branch", branch: "feature-a" },
      });
      const second = yield* prepare({
        projectCwd: repo,
        threadId: "thread-retry",
        commandId: "cmd-retry",
        selection: { kind: "branch", branch: "feature-a" },
      });
      expect(second.worktreePath).toBe(first.worktreePath);
      expect(second.branch).toBe("feature-a");
    }),
  );

  it.effect("creates a named branch from a base ref inside the worktree", () =>
    Effect.gen(function* () {
      const repo = yield* makeRepo();
      const result = yield* prepare({
        projectCwd: repo,
        threadId: "thread-create",
        commandId: "cmd-create",
        selection: { kind: "create-branch", branch: "feature-new", baseRef: "main" },
      });
      expect(result.branch).toBe("feature-new");
      expect(yield* gitText(result.worktreePath!, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
        "feature-new",
      );
      // The project checkout keeps its own branch.
      expect(yield* gitText(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
    }),
  );

  it.effect("refuses an occupied branch instead of forcing checkout", () =>
    Effect.gen(function* () {
      const repo = yield* makeRepo();
      const a = yield* prepare({
        projectCwd: repo,
        threadId: "thread-occupied-a",
        commandId: "cmd-occupied-a",
        selection: { kind: "branch", branch: "feature-a" },
      });
      const fs = yield* FileSystem.FileSystem;
      yield* writeFile(a.worktreePath!, "owned.txt", "keep\n");

      const exit = yield* Effect.exit(
        prepare({
          projectCwd: repo,
          threadId: "thread-occupied-b",
          commandId: "cmd-occupied-b",
          selection: { kind: "branch", branch: "feature-a" },
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(failureMessage(exit)).toContain("Workspace preparation failed");
      // The existing checkout and the project branch are untouched.
      expect(yield* fs.exists(`${a.worktreePath!}/owned.txt`)).toBe(true);
      expect(yield* gitText(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
    }),
  );

  it.effect("rejects attaching a workspace from another repository", () =>
    Effect.gen(function* () {
      const repo = yield* makeRepo();
      const other = yield* makeRepo();
      const exit = yield* Effect.exit(
        prepare({
          projectCwd: repo,
          threadId: "thread-attach",
          commandId: "cmd-attach",
          selection: { kind: "attach", worktreePath: other },
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(failureMessage(exit)).toContain("wrong repository");
    }),
  );

  it.effect("rejects a missing attach path", () =>
    Effect.gen(function* () {
      const repo = yield* makeRepo();
      const exit = yield* Effect.exit(
        prepare({
          projectCwd: repo,
          threadId: "thread-missing",
          commandId: "cmd-missing",
          selection: { kind: "attach", worktreePath: `${repo}/does-not-exist` },
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(failureMessage(exit)).toContain("missing workspace");
    }),
  );
});
