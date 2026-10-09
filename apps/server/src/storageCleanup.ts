import { CommandId } from "@e6tools/contracts";
import type {
  OrchestrationThreadShell,
  ProjectId,
  ServerSettings,
  ServerSettingsError,
  TerminalSummary,
  WorktreeCleanupRules,
} from "@e6tools/contracts";
import { resolveWorktreeCleanup } from "@e6tools/shared/projectSettings";
import { makeDrainableWorker } from "@e6tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerConfig from "./config.ts";
import * as GitManager from "./git/GitManager.ts";
import * as ProjectionSnapshotQuery from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import * as OrchestrationEngine from "./orchestration/Services/OrchestrationEngine.ts";
import * as ThreadDeletionReactor from "./orchestration/Services/ThreadDeletionReactor.ts";
import * as ProviderService from "./provider/Services/ProviderService.ts";
import { ProjectionTurnRepository } from "./persistence/Services/ProjectionTurns.ts";
import { ProviderRuntimeIngestionService } from "./orchestration/Services/ProviderRuntimeIngestion.ts";
import { threadHasQueuedTurnStart } from "./orchestration/ThreadSettlementPolicy.ts";
import { forkParked } from "./serverActivation.ts";
import * as Settings from "./serverSettings.ts";
import * as TerminalManager from "./terminal/Manager.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";
import { withWorkspaceLease } from "./workspace/workspaceLease.ts";

export class StorageCleanup extends Context.Service<
  StorageCleanup,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("e6/storageCleanup") {}

const DAY_MS = 86_400_000;

const worktreeCleanupEnabled = (rules: WorktreeCleanupRules) =>
  rules.worktreeAfterDays !== null ||
  rules.worktreeOnMerge ||
  rules.worktreeOnDelete ||
  rules.worktreeUnchanged;

function anyWorktreePolicy(
  settings: ServerSettings,
  predicate: (rules: WorktreeCleanupRules) => boolean,
): boolean {
  return (
    predicate(resolveWorktreeCleanup(settings, null)) ||
    Object.keys(settings.projectSettingsOverrides).some((projectId) =>
      predicate(resolveWorktreeCleanup(settings, projectId as ProjectId)),
    )
  );
}

function sameProjectWorktreePolicies(left: ServerSettings, right: ServerSettings): boolean {
  return [
    ...new Set([
      ...Object.keys(left.projectSettingsOverrides),
      ...Object.keys(right.projectSettingsOverrides),
    ]),
  ].every((projectId) =>
    Equal.equals(
      left.projectSettingsOverrides[projectId as ProjectId]?.worktreeCleanup,
      right.projectSettingsOverrides[projectId as ProjectId]?.worktreeCleanup,
    ),
  );
}

/** Only archived ready sessions can be released by automatic cleanup. */
function storageCleanupThreadIdle(thread: OrchestrationThreadShell, now: number): boolean {
  return (
    thread.branch !== null &&
    thread.worktreePath !== null &&
    (thread.session === null ||
      thread.session.status === "stopped" ||
      (thread.archivedAt !== null &&
        thread.session.status === "ready" &&
        thread.session.activeTurnId === null)) &&
    thread.latestTurn?.state !== "running" &&
    thread.backgroundLiveness == null &&
    !thread.hasPendingApprovals &&
    !thread.hasPendingUserInput &&
    !threadHasQueuedTurnStart(thread, DateTime.formatIso(DateTime.makeUnsafe(now)))
  );
}

/** PR metadata refreshes must not reset the inactivity clock. */
function storageCleanupActivityAt(thread: OrchestrationThreadShell): number {
  return Math.max(
    ...[
      thread.createdAt,
      thread.latestUserMessageAt,
      thread.latestTurn?.requestedAt,
      thread.latestTurn?.startedAt,
      thread.latestTurn?.completedAt,
    ].flatMap((value) => (value == null ? [] : [Date.parse(value)])),
  );
}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const settingsService = yield* Settings.ServerSettingsService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const threadDeletion = yield* ThreadDeletionReactor.ThreadDeletionReactor;
  const providers = yield* ProviderService.ProviderService;
  const turns = yield* ProjectionTurnRepository;
  const runtimeIngestion = yield* ProviderRuntimeIngestionService;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const gitManager = yield* GitManager.GitManager;
  const terminals = yield* TerminalManager.TerminalManager;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const liveTerminals = new Map<string, Map<string, TerminalSummary>>();
  const noteTerminal = (terminal: TerminalSummary) => {
    const threadTerminals =
      liveTerminals.get(terminal.threadId) ?? new Map<string, TerminalSummary>();
    threadTerminals.set(terminal.terminalId, terminal);
    liveTerminals.set(terminal.threadId, threadTerminals);
  };

  const inside = (root: string, target: string) => {
    const relative = path.relative(root, target);
    return (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };
  const canonicalPath = (target: string) =>
    fs.realPath(path.resolve(target)).pipe(Effect.orElseSucceed(() => path.resolve(target)));
  const hasTerminal = Effect.fnUntraced(function* (worktreePath: string) {
    for (const entries of liveTerminals.values()) {
      for (const terminal of entries.values()) {
        if (terminal.status !== "starting" && terminal.status !== "running") continue;
        const cwd = yield* canonicalPath(terminal.cwd);
        if (
          cwd === worktreePath ||
          inside(worktreePath, cwd) ||
          (terminal.worktreePath !== null &&
            (yield* canonicalPath(terminal.worktreePath)) === worktreePath)
        )
          return true;
      }
    }
    return false;
  });

  const readThreads = Effect.fn("StorageCleanup.readThreads")(function* () {
    const active = yield* snapshots.getShellSnapshot();
    const archived = yield* snapshots.getArchivedShellSnapshot();
    return { projects: active.projects, threads: [...active.threads, ...archived.threads] };
  });

  // Local threads under another project need not have a worktreePath of their own.
  const containsProjectRoot = Effect.fn("StorageCleanup.containsProjectRoot")(function* (
    worktreePath: string,
    projects: ReadonlyArray<{ readonly workspaceRoot: string }>,
  ) {
    for (const project of [
      ...projects,
      ...[config.cwd, config.baseDir, config.stateDir].map((workspaceRoot) => ({ workspaceRoot })),
    ]) {
      const projectPath = path.resolve(project.workspaceRoot);
      if (projectPath === worktreePath || inside(worktreePath, projectPath)) return true;
      const realPath = yield* fs
        .realPath(projectPath)
        .pipe(Effect.orElseSucceed(() => projectPath));
      if (realPath === worktreePath || inside(worktreePath, realPath)) return true;
    }
    return false;
  });

  const cleanWorktrees = Effect.fn("StorageCleanup.cleanWorktrees")(function* (
    serverSettings: ServerSettings,
    now: number,
  ) {
    if (!anyWorktreePolicy(serverSettings, worktreeCleanupEnabled)) return;
    if (!(yield* fs.exists(config.worktreesDir))) return;
    const hasDeleteRule = anyWorktreePolicy(serverSettings, (rules) => rules.worktreeOnDelete);
    const deletedThreads = hasDeleteRule
      ? (yield* snapshots.getDeletedWorktreeThreads()).filter(
          (thread) => resolveWorktreeCleanup(serverSettings, thread.projectId).worktreeOnDelete,
        )
      : [];
    if (deletedThreads.length > 0) {
      // Read tombstones before taking this fence. A later deletion waits for the
      // next sweep; every captured deletion must finish stopping its resources.
      const { snapshotSequence } = yield* snapshots.getSnapshotSequence();
      yield* threadDeletion.drainThrough(snapshotSequence);
    }
    const snapshot = yield* readThreads();
    const root = yield* fs.realPath(config.worktreesDir);
    const refreshedDefaultRefs = new Map<string, Set<string>>();
    const references = yield* Effect.forEach(
      snapshot.threads.filter((thread) => thread.worktreePath !== null),
      (thread) =>
        canonicalPath(thread.worktreePath!).pipe(Effect.map((identity) => ({ thread, identity }))),
    );
    const groups = Map.groupBy(references, (entry) => entry.identity);
    const summary = { removed: 0, retained: 0, failed: 0, reasons: {} as Record<string, number> };
    const retain = (reason: string) => {
      summary.retained++;
      summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1;
    };
    for (const group of groups.values()) if (group.length > 1) retain("shared");
    const deletedReferences = yield* Effect.forEach(deletedThreads, (thread) =>
      canonicalPath(thread.worktreePath).pipe(Effect.map((identity) => ({ thread, identity }))),
    );
    const candidates = [
      ...[...groups.values()].flatMap((group) => (group.length === 1 ? [group[0]!.thread] : [])),
      ...deletedReferences
        .filter((entry) => !groups.has(entry.identity))
        .map((entry) => entry.thread),
    ];
    for (const thread of candidates) {
      const settings = resolveWorktreeCleanup(serverSettings, thread.projectId);
      if (!worktreeCleanupEnabled(settings)) {
        retain("policy-off");
        continue;
      }
      const worktreePath = path.resolve(thread.worktreePath!);
      const deleted = "deletedAt" in thread;
      const archivedAt = deleted ? null : thread.archivedAt;
      const activityAt = deleted ? null : storageCleanupActivityAt(thread);
      const project = deleted
        ? { workspaceRoot: thread.workspaceRoot }
        : snapshot.projects.find((entry) => entry.id === thread.projectId);
      if (
        project === undefined ||
        (!deleted && !storageCleanupThreadIdle(thread, now)) ||
        (yield* hasTerminal(worktreePath))
      ) {
        retain(
          project === undefined
            ? "project-missing"
            : (yield* hasTerminal(worktreePath))
              ? "terminal"
              : "thread-active",
        );
        continue;
      }
      yield* Effect.gen(function* () {
        if (!inside(root, worktreePath)) return retain("outside-managed-root");
        if (!(yield* fs.exists(worktreePath))) return retain("already-missing");
        if ((yield* fs.realPath(worktreePath)) !== worktreePath) return retain("noncanonical-path");
        if (yield* containsProjectRoot(worktreePath, [project, ...snapshot.projects]))
          return retain("project-root");
        // A linked worktree has a .git file. Never remove a main checkout.
        if ((yield* fs.stat(path.join(worktreePath, ".git"))).type !== "File")
          return retain("main-checkout");
        const status = yield* git.statusDetailsLocal(worktreePath);
        if (!status.isRepo || status.branch !== thread.branch || status.hasWorkingTreeChanges)
          return retain("git-state");
        const head = yield* git.resolveCommit({ cwd: worktreePath, revision: "HEAD" });
        const old =
          !deleted &&
          settings.worktreeAfterDays !== null &&
          storageCleanupActivityAt(thread) < now - settings.worktreeAfterDays * DAY_MS;
        let eligible = deleted || old;
        if (!eligible && (settings.worktreeUnchanged || settings.worktreeOnMerge)) {
          const repositoryCwd = path.resolve(project.workspaceRoot);
          const remote = yield* git.resolvePrimaryRemoteName(repositoryCwd);
          const branch = yield* git.resolveDefaultBranchName(repositoryCwd, remote);
          if (branch === null) return retain("default-branch-missing");
          const defaultRef = `refs/remotes/${remote}/${branch}`;
          const refreshed = refreshedDefaultRefs.get(repositoryCwd) ?? new Set<string>();
          if (!refreshed.has(defaultRef)) {
            yield* git.fetchRemoteTrackingBranch({
              cwd: repositoryCwd,
              remoteName: remote,
              remoteBranch: branch,
            });
            refreshed.add(defaultRef);
            refreshedDefaultRefs.set(repositoryCwd, refreshed);
          }
          const base = yield* git.resolveCommit({
            cwd: worktreePath,
            revision: defaultRef,
          });
          const ancestor = yield* git.execute({
            operation: "StorageCleanup.integratedBranch",
            cwd: worktreePath,
            args: ["merge-base", "--is-ancestor", head.commitSha, base.commitSha],
            allowNonZeroExit: true,
          });
          if (ancestor.exitCode !== 0) return retain("unmerged-commits");
          eligible = settings.worktreeUnchanged;
          if (!eligible && settings.worktreeOnMerge && thread.branch !== null) {
            const pullRequest = yield* gitManager.branchPullRequest(
              { cwd: worktreePath, branch: thread.branch },
              { refresh: true },
            );
            eligible = pullRequest?.state === "merged";
          }
        }
        if (!eligible) return retain("rule-not-matched");
        let latestThread = snapshot.threads.find((entry) => entry.id === thread.id);
        const revalidate = Effect.fnUntraced(function* (allowReady: boolean) {
          const current = resolveWorktreeCleanup(
            yield* settingsService.getSettings,
            thread.projectId,
          );
          if (!Equal.equals(settings, current)) return "policy-changed";
          const latestSnapshot = yield* readThreads();
          if (yield* containsProjectRoot(worktreePath, [project, ...latestSnapshot.projects]))
            return "project-root";
          const latestReferences = yield* Effect.forEach(
            latestSnapshot.threads.filter((entry) => entry.worktreePath !== null),
            (entry) =>
              canonicalPath(entry.worktreePath!).pipe(
                Effect.map((identity) => ({ entry, identity })),
              ),
          );
          const latest = latestReferences
            .filter((ref) => ref.identity === worktreePath)
            .map((ref) => ref.entry);
          latestThread = latest[0];
          if (yield* hasTerminal(worktreePath)) return "terminal";
          if (deleted) {
            if (latest.length > 0) return "shared";
          } else {
            if (latest.length !== 1 || latestThread!.id !== thread.id) return "shared";
            if (
              !storageCleanupThreadIdle(latestThread!, now) ||
              latestThread!.archivedAt !== archivedAt ||
              storageCleanupActivityAt(latestThread!) !== activityAt
            )
              return "thread-changed";
            if (
              !allowReady &&
              latestThread!.session !== null &&
              latestThread!.session.status !== "stopped"
            )
              return "session-active";
          }
          if (Option.isSome(yield* turns.getPendingTurnStartByThreadId({ threadId: thread.id })))
            return "pending-turn";
          for (const session of yield* providers.listSessions()) {
            if (session.status === "closed") continue;
            const sessionCwd =
              session.cwd === undefined ? undefined : yield* canonicalPath(session.cwd);
            const usesWorktree =
              session.threadId === thread.id ||
              (sessionCwd !== undefined &&
                (sessionCwd === worktreePath || inside(worktreePath, sessionCwd)));
            if (
              usesWorktree &&
              !(
                allowReady &&
                !deleted &&
                archivedAt !== null &&
                latestThread?.session?.status === "ready" &&
                session.threadId === thread.id &&
                session.status === "ready" &&
                session.activeTurnId == null
              )
            )
              return "provider-active";
          }
          return null;
        });
        const validateGit = Effect.fnUntraced(function* () {
          const finalStatus = yield* git.statusDetailsLocal(worktreePath);
          if (
            !finalStatus.isRepo ||
            finalStatus.branch !== thread.branch ||
            finalStatus.hasWorkingTreeChanges
          )
            return "git-state";
          if (
            (yield* git.resolveCommit({ cwd: worktreePath, revision: "HEAD" })).commitSha !==
            head.commitSha
          )
            return "head-changed";
          return null;
        });
        const beforeStop = (yield* validateGit()) ?? (yield* revalidate(true));
        if (beforeStop !== null) return retain(beforeStop);
        if (!deleted && latestThread?.session?.status === "ready") {
          const session = latestThread.session;
          yield* providers.stopSession({ threadId: thread.id });
          yield* runtimeIngestion.flush;
          // The provider directory stop does not update the orchestration projection.
          yield* engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make(`storage-cleanup-stop:${thread.id}:${session.updatedAt}`),
            threadId: thread.id,
            session: {
              ...session,
              status: "stopped",
              activeTurnId: null,
              updatedAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
            },
            createdAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
          });
        }
        const beforeRemoval = (yield* validateGit()) ?? (yield* revalidate(false));
        if (beforeRemoval !== null) return retain(beforeRemoval);
        yield* git.removeWorktree({ cwd: project.workspaceRoot, path: worktreePath, force: false });
        summary.removed++;
        yield* gitManager.invalidateStatus(project.workspaceRoot).pipe(
          Effect.catch(() =>
            Effect.logWarning("storage cleanup status refresh failed", {
              reason: "status-refresh-failed",
            }),
          ),
        );
        // Preserve branch and path: ProviderCommandReactor recreates the checkout
        // from that branch when the thread is resumed.
        yield* Effect.logInfo("storage cleanup removed worktree", { threadId: thread.id });
      }).pipe(
        (effect) => withWorkspaceLease(worktreePath, effect),
        Effect.catch(() => {
          summary.failed++;
          return Effect.logWarning("storage cleanup failed to remove worktree", {
            threadId: thread.id,
            reason: "cleanup-failed",
          });
        }),
      );
    }
    if (summary.removed + summary.retained + summary.failed > 0)
      yield* Effect.logInfo("storage cleanup worktree sweep", summary);
  });

  const cleanFiles = Effect.fn("StorageCleanup.cleanFiles")(function* (
    root: string,
    days: number | null,
    now: number,
    rotatedLogs: boolean,
  ) {
    if (days === null || !(yield* fs.exists(root))) return;
    const realRoot = yield* fs.realPath(root);
    if (realRoot !== path.resolve(root)) return;
    const visit = Effect.fn("StorageCleanup.visitFiles")(function* (
      directory: string,
    ): Effect.fn.Return<void, PlatformError | ServerSettingsError> {
      for (const name of yield* fs.readDirectory(directory)) {
        const target = path.join(directory, name);
        if ((yield* fs.realPath(target)) !== target || !inside(realRoot, target)) continue;
        const stat = yield* fs.stat(target);
        if (stat.type === "Directory" && rotatedLogs) {
          yield* visit(target);
        } else if (stat.type === "File" && (!rotatedLogs || /\.(?:log|ndjson)\.\d+$/.test(name))) {
          const modified = Option.getOrNull(stat.mtime);
          if (modified !== null && modified.getTime() < now - days * DAY_MS) {
            const current = (yield* settingsService.getSettings).storageCleanup;
            if ((rotatedLogs ? current.logsAfterDays : current.browserArtifactsAfterDays) !== days)
              return;
            yield* fs.remove(target);
          }
        }
      }
    });
    yield* visit(realRoot);
  });

  const sweep = Effect.fn("StorageCleanup.sweep")(function* () {
    const serverSettings = yield* settingsService.getSettings;
    const settings = serverSettings.storageCleanup;
    const now = yield* Clock.currentTimeMillis;
    yield* cleanWorktrees(serverSettings, now).pipe(
      Effect.catch((error) => Effect.logWarning("worktree cleanup failed", { error })),
    );
    yield* cleanFiles(
      config.browserArtifactsDir,
      settings.browserArtifactsAfterDays,
      now,
      false,
    ).pipe(
      Effect.catch((error) => Effect.logWarning("browser artifact cleanup failed", { error })),
    );
    yield* cleanFiles(config.logsDir, settings.logsAfterDays, now, true).pipe(
      Effect.catch((error) => Effect.logWarning("rotated log cleanup failed", { error })),
    );
  });
  const worker = yield* makeDrainableWorker(() =>
    sweep().pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("storage cleanup failed", { cause }),
      ),
    ),
  );

  const start = Effect.fn("StorageCleanup.start")(function* () {
    let lastSettings = yield* settingsService.getSettings.pipe(Effect.orDie);
    const unsubscribe = yield* terminals.subscribeMetadata((event) =>
      Effect.sync(() => {
        if (event.type === "snapshot") {
          liveTerminals.clear();
          for (const terminal of event.terminals) noteTerminal(terminal);
        } else if (event.type === "upsert") {
          noteTerminal(event.terminal);
        } else {
          const threadTerminals = liveTerminals.get(event.threadId);
          threadTerminals?.delete(event.terminalId);
          if (threadTerminals?.size === 0) liveTerminals.delete(event.threadId);
        }
      }).pipe(
        Effect.andThen(
          Effect.suspend(() =>
            event.type !== "snapshot" &&
            (event.type !== "upsert" ||
              (event.terminal.status !== "starting" && event.terminal.status !== "running")) &&
            anyWorktreePolicy(lastSettings, worktreeCleanupEnabled)
              ? worker.enqueue(undefined)
              : Effect.void,
          ),
        ),
      ),
    );
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    const changes = yield* settingsService.subscribeChanges;
    const events = yield* engine.subscribeDomainEvents;
    yield* forkParked(
      worker
        .enqueue(undefined)
        .pipe(
          Effect.andThen(worker.drain),
          Effect.repeat(Schedule.spaced("1 hour")),
          Effect.asVoid,
        ),
    );
    yield* forkParked(
      Stream.runForEach(changes, (settings) => {
        if (
          Equal.equals(settings.storageCleanup, lastSettings.storageCleanup) &&
          Equal.equals(settings.worktreeCleanup, lastSettings.worktreeCleanup) &&
          sameProjectWorktreePolicies(settings, lastSettings)
        )
          return Effect.void;
        lastSettings = settings;
        return worker.enqueue(undefined);
      }),
    );
    yield* forkParked(
      Stream.runForEach(events, (event) =>
        (
          event.type === "thread.deleted"
            ? anyWorktreePolicy(lastSettings, (rules) => rules.worktreeOnDelete)
            : (event.type === "thread.archived" ||
                (event.type === "thread.session-set" &&
                  event.payload.session.status === "stopped")) &&
              anyWorktreePolicy(lastSettings, worktreeCleanupEnabled)
        )
          ? worker.enqueue(undefined)
          : Effect.void,
      ),
    );
  });
  return { start, drain: worker.drain } satisfies StorageCleanup["Service"];
});

export const layer = Layer.effect(StorageCleanup, make);
