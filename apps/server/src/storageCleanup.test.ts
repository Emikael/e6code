import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationEvent,
  type TerminalMetadataStreamEvent,
  type ServerSettings,
  type OrchestrationShellSnapshot,
  type OrchestrationThreadShell,
} from "@e6tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { deriveServerPaths, ServerConfig } from "./config.ts";
import { GitManager } from "./git/GitManager.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRuntimeIngestionService } from "./orchestration/Services/ProviderRuntimeIngestion.ts";
import { ThreadDeletionReactor } from "./orchestration/Services/ThreadDeletionReactor.ts";
import { ProjectionTurnRepository } from "./persistence/Services/ProjectionTurns.ts";
import { ProviderService } from "./provider/Services/ProviderService.ts";
import { ServerSettingsService } from "./serverSettings.ts";
import * as StorageCleanup from "./storageCleanup.ts";
import { TerminalManager } from "./terminal/Manager.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";

const NOW = "2026-10-09T12:00:00.000Z";
const OLD = "2026-08-01T00:00:00.000Z";
const PROJECT_ID = ProjectId.make("cleanup-project");
const ConfigLayer = Layer.effect(
  ServerConfig,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const baseDir = yield* fs.realPath(config.baseDir);
    return { ...config, baseDir, ...(yield* deriveServerPaths(baseDir, config.devUrl)) };
  }),
).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "e6-cleanup-real-git-" })));
const TestLayer = GitVcsDriver.layer.pipe(
  Layer.provideMerge(ConfigLayer),
  Layer.provideMerge(NodeServices.layer),
);

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const driver = yield* GitVcsDriver.GitVcsDriver;
  const cwd = path.join(config.baseDir, "repository");
  const worktreePath = path.join(config.worktreesDir, "feature");
  yield* fs.makeDirectory(cwd);
  const git = (args: ReadonlyArray<string>) =>
    driver.execute({ operation: "StorageCleanup.test.git", cwd, args });
  yield* git(["init", "--initial-branch=main"]);
  yield* git(["config", "user.name", "Cleanup Test"]);
  yield* git(["config", "user.email", "cleanup@example.test"]);
  yield* fs.writeFileString(path.join(cwd, "source.txt"), "committed content\n");
  yield* fs.writeFileString(
    path.join(cwd, ".gitignore"),
    "target/\n.serena/\n.remember/\nnode_modules/\n.env\nprivate-dataset/\n",
  );
  yield* git(["add", "."]);
  yield* git(["commit", "-m", "initial"]);
  yield* git(["worktree", "add", "-b", "feature", worktreePath]);
  yield* fs.writeFileString(path.join(worktreePath, "source.txt"), "committed feature content\n");
  yield* driver.execute({
    operation: "StorageCleanup.test.featureCommit",
    cwd: worktreePath,
    args: ["commit", "-am", "feature content"],
  });
  const write = (name: string, content = "local data\n") =>
    Effect.gen(function* () {
      const target = path.join(worktreePath, name);
      yield* fs.makeDirectory(path.dirname(target), { recursive: true });
      yield* fs.writeFileString(target, content);
    });
  const thread: OrchestrationThreadShell = {
    id: ThreadId.make("cleanup-thread"),
    projectId: PROJECT_ID,
    title: "Cleanup thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    pullRequests: [],
    branch: "feature",
    worktreePath,
    latestTurn: null,
    createdAt: OLD,
    updatedAt: OLD,
    archivedAt: OLD,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: OLD,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
  const project = {
    id: PROJECT_ID,
    title: "Cleanup project",
    workspaceRoot: cwd,
    defaultModelSelection: null,
    scripts: [],
    createdAt: OLD,
    updatedAt: OLD,
  };
  const snapshot = (
    threads: ReadonlyArray<OrchestrationThreadShell>,
  ): OrchestrationShellSnapshot => ({
    snapshotSequence: 1,
    projects: [project],
    threads,
    updatedAt: NOW,
  });
  const sweep = (
    mode: "deleted" | "archived",
    shared = false,
    trigger?: "settings" | "archive" | "session" | "terminal",
  ) =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      let snapshotRead = yield* Deferred.make<void>();
      const events = yield* PubSub.unbounded<OrchestrationEvent>();
      const changes = yield* PubSub.unbounded<ServerSettings>();
      let terminalListener:
        | ((event: TerminalMetadataStreamEvent) => Effect.Effect<void>)
        | undefined;
      const session = {
        threadId: thread.id,
        status: "running" as const,
        providerName: "codex" as const,
        runtimeMode: "full-access" as const,
        activeTurnId: null,
        lastError: null,
        updatedAt: NOW,
      };
      let currentThread = trigger === "session" ? { ...thread, session } : thread;
      if (trigger === "archive") {
        currentThread = { ...thread, archivedAt: null };
        yield* write("source.txt", "unfinished edit\n");
      }
      const settings = yield* ServerSettingsService.pipe(
        Effect.provide(
          ServerSettingsService.layerTest({
            storageCleanup: {
              worktreeAfterDays: trigger === "settings" ? 365 : mode === "archived" ? 8 : null,
              worktreeOnDelete: true,
              worktreeOnMerge: false,
              worktreeUnchanged: false,
              browserArtifactsAfterDays: null,
              logsAfterDays: null,
            },
          }),
        ),
      );
      const cleanup = yield* StorageCleanup.make.pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(ServerSettingsService, {
              ...settings,
              subscribeChanges: PubSub.subscribe(changes).pipe(Effect.map(Stream.fromSubscription)),
            }),
            Layer.mock(ProjectionSnapshotQuery)({
              getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 1 }),
              getDeletedWorktreeThreads: () =>
                Effect.succeed(
                  mode === "deleted"
                    ? [
                        {
                          id: thread.id,
                          projectId: PROJECT_ID,
                          branch: "feature",
                          worktreePath,
                          workspaceRoot: cwd,
                          deletedAt: NOW,
                        },
                      ]
                    : [],
                ),
              getShellSnapshot: () =>
                Deferred.succeed(snapshotRead, undefined).pipe(
                  Effect.as(
                    snapshot(
                      shared
                        ? [{ ...thread, id: ThreadId.make("sharing-thread"), archivedAt: null }]
                        : [],
                    ),
                  ),
                ),
              getArchivedShellSnapshot: () =>
                Effect.succeed(snapshot(mode === "archived" ? [currentThread] : [])),
            }),
            Layer.mock(ProjectionTurnRepository)({
              getPendingTurnStartByThreadId: () => Effect.succeed(Option.none()),
            }),
            Layer.mock(ProviderRuntimeIngestionService)({ drain: Effect.void, flush: Effect.void }),
            Layer.mock(OrchestrationEngineService)({
              subscribeDomainEvents: PubSub.subscribe(events).pipe(
                Effect.map(Stream.fromSubscription),
              ),
            }),
            Layer.mock(ThreadDeletionReactor)({ drainThrough: () => Effect.void }),
            Layer.mock(ProviderService)({ listSessions: () => Effect.succeed([]) }),
            Layer.mock(GitManager)({ invalidateStatus: () => Effect.void }),
            Layer.mock(TerminalManager)({
              subscribeMetadata: (listener) => {
                terminalListener = listener;
                return listener({
                  type: "snapshot",
                  terminals:
                    trigger === "terminal"
                      ? [
                          {
                            threadId: thread.id,
                            terminalId: "shell",
                            cwd: worktreePath,
                            worktreePath,
                            status: "running",
                            pid: 1,
                            exitCode: null,
                            exitSignal: null,
                            hasRunningSubprocess: false,
                            label: "shell",
                            updatedAt: NOW,
                          },
                        ]
                      : [],
                }).pipe(Effect.as(() => {}));
              },
            }),
          ),
        ),
      );
      yield* cleanup.start();
      yield* Deferred.await(snapshotRead);
      yield* cleanup.drain;
      if (trigger !== undefined) {
        assert.strictEqual(yield* fs.exists(worktreePath), true);
        snapshotRead = yield* Deferred.make<void>();
        if (trigger === "settings") {
          const updated = yield* settings.updateSettings({
            storageCleanup: { worktreeAfterDays: 8 },
          });
          yield* PubSub.publish(changes, updated);
        } else if (trigger === "terminal") {
          assert(terminalListener !== undefined);
          yield* terminalListener({ type: "remove", threadId: thread.id, terminalId: "shell" });
        } else {
          if (trigger === "archive") {
            yield* driver.execute({
              operation: "StorageCleanup.test.restore",
              cwd: worktreePath,
              args: ["restore", "source.txt"],
            });
            currentThread = { ...currentThread, archivedAt: NOW };
          } else {
            currentThread = { ...currentThread, session: { ...session, status: "stopped" } };
          }
          yield* PubSub.publish(events, {
            sequence: 2,
            eventId: EventId.make(`cleanup-${trigger}`),
            aggregateKind: "thread",
            aggregateId: thread.id,
            occurredAt: NOW,
            commandId: null,
            causationEventId: null,
            correlationId: null,
            metadata: {},
            ...(trigger === "archive"
              ? {
                  type: "thread.archived" as const,
                  payload: { threadId: thread.id, archivedAt: NOW, updatedAt: NOW },
                }
              : {
                  type: "thread.session-set" as const,
                  payload: {
                    threadId: thread.id,
                    session: { ...session, status: "stopped" as const },
                  },
                }),
          });
        }
        yield* Deferred.await(snapshotRead);
        yield* cleanup.drain;
      }
    });
  return { fs, path, driver, cwd, worktreePath, git, write, thread, sweep };
});

describe("storage cleanup with real Git worktrees", () => {
  for (const trigger of ["settings", "archive", "session", "terminal"] as const) {
    it.effect(`removes newly eligible worktrees after ${trigger} changes`, () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.write(".env");
        yield* f.sweep("archived", false, trigger);
        assert.strictEqual(yield* f.fs.exists(f.worktreePath), false);
        assert.strictEqual(
          (yield* f.git(["worktree", "list", "--porcelain"])).stdout.includes(f.worktreePath),
          false,
        );
      }).pipe(Effect.provide(TestLayer), Effect.scoped),
    );
  }
  it.effect("treats repeated startup cleanup of an already missing worktree as a no-op", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.sweep("archived");
      assert.strictEqual(yield* f.fs.exists(f.worktreePath), false);
      yield* f.sweep("archived");
      assert.strictEqual(yield* f.fs.exists(f.worktreePath), false);
      assert.strictEqual(
        (yield* f.git(["rev-parse", "--verify", "refs/heads/feature"])).exitCode,
        0,
      );
    }).pipe(Effect.provide(TestLayer), Effect.scoped),
  );
  for (const mode of ["deleted", "archived"] as const) {
    for (const ignored of [
      "target/build",
      ".serena/state",
      ".remember/notes",
      "node_modules/package/index.js",
      ".env",
      "private-dataset/data.csv",
    ]) {
      it.effect(
        `removes ${mode} worktrees containing ignored ${ignored} and preserves their branch`,
        () =>
          Effect.gen(function* () {
            const f = yield* fixture;
            yield* f.write(ignored);
            assert.strictEqual(
              (yield* f.driver.statusDetailsLocal(f.worktreePath)).hasWorkingTreeChanges,
              false,
            );
            yield* f.sweep(mode);
            assert.strictEqual(yield* f.fs.exists(f.worktreePath), false);
            assert.strictEqual(
              (yield* f.git(["worktree", "list", "--porcelain"])).stdout.includes(f.worktreePath),
              false,
            );
            assert.strictEqual(
              (yield* f.git(["rev-parse", "--verify", "refs/heads/feature"])).exitCode,
              0,
            );
            assert.strictEqual(f.thread.worktreePath, f.worktreePath);
            assert.strictEqual(f.thread.branch, "feature");
            if (mode === "archived" && ignored === ".env") {
              yield* f.driver.createWorktree({
                cwd: f.cwd,
                refName: "feature",
                path: f.worktreePath,
              });
              assert.strictEqual(
                yield* f.fs.readFileString(f.path.join(f.worktreePath, "source.txt")),
                "committed feature content\n",
              );
            }
          }).pipe(Effect.provide(TestLayer), Effect.scoped),
      );
    }
    for (const protection of ["source edit", "untracked file", "shared reference"] as const) {
      it.effect(`retains ${mode} worktrees with a ${protection}`, () =>
        Effect.gen(function* () {
          const f = yield* fixture;
          const name = protection === "source edit" ? "source.txt" : "untracked.txt";
          if (protection !== "shared reference") yield* f.write(name, "must survive\n");
          yield* f.sweep(mode, protection === "shared reference");
          assert.strictEqual(yield* f.fs.exists(f.worktreePath), true);
          assert.strictEqual(
            (yield* f.git(["worktree", "list", "--porcelain"])).stdout.includes(f.worktreePath),
            true,
          );
          if (protection !== "shared reference")
            assert.strictEqual(
              yield* f.fs.readFileString(f.path.join(f.worktreePath, name)),
              "must survive\n",
            );
        }).pipe(Effect.provide(TestLayer), Effect.scoped),
      );
    }
  }
});
