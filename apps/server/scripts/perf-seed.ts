#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - reads the account's home directory to refuse the live E6 home.
/**
 * Seeds a throwaway E6 home for the web performance harness:
 *
 *   node apps/server/scripts/perf-seed.ts --base-dir <home> --workspace <repo> \
 *     [--threads 50] [--long-thread-turns 1000] [--turns-per-thread 4] \
 *     [--provider cursor[,claudeAgent,...]] [--long-thread-shape turns|imported-messages]
 *
 * Commands from `perfSeedCommands.ts` go through the real orchestration engine
 * offline, the way `e6 project` works without a server, so the home opens with
 * consistent projections. It refuses the live home (`~/.e6`, `E6CODE_HOME`) and
 * any home that already has a database or a server descriptor. It prints one
 * JSON line with the seed's duration, counts and highest event sequence.
 */
import * as NodeOS from "node:os";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderDriverKind } from "@e6tools/contracts";
import { DATA_DIR_NAME, readBrandEnv } from "@e6tools/shared/brand";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/unstable/cli";

import * as ServerConfig from "../src/config.ts";
import { OrchestrationEngineService } from "../src/orchestration/Services/OrchestrationEngine.ts";
import { OrchestrationLayerLive } from "../src/orchestration/runtimeLayer.ts";
import { layerConfig } from "../src/persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../src/project/RepositoryIdentityResolver.ts";
import {
  buildPerfSeedPlan,
  type PerfSeedLongThreadShape,
  type PerfSeedOptions,
} from "./perfSeedCommands.ts";

export class PerfSeedUnsafeHomeError extends Schema.TaggedError<PerfSeedUnsafeHomeError>()(
  "PerfSeedUnsafeHomeError",
  { baseDir: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return `Refusing to seed '${this.baseDir}': ${this.reason}. Pass a fresh throwaway --base-dir.`;
  }
}

/**
 * The engine and projections over the home at `baseDir`, without reactors or
 * providers. Projections read only the home's paths from `ServerConfig`, so the
 * fixed configuration `layerTest` derives from the base directory is enough.
 */
export const perfSeedRuntimeLayer = (input: { readonly baseDir: string; readonly cwd: string }) =>
  OrchestrationLayerLive.pipe(
    Layer.provideMerge(RepositoryIdentityResolver.layer),
    Layer.provideMerge(layerConfig),
    Layer.provideMerge(ServerConfig.layerTest(input.cwd, input.baseDir)),
  );

/** The real path of `target`, resolved through its nearest existing ancestor. */
const realPathThroughAncestors = Effect.fnUntraced(function* (target: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  let existing = path.resolve(target);
  const missing: Array<string> = [];
  while (!(yield* fileSystem.exists(existing).pipe(Effect.orElseSucceed(() => false)))) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  const real = yield* fileSystem.realPath(existing).pipe(Effect.orElseSucceed(() => existing));
  return path.join(real, ...missing);
});

/** Live E6 homes the seed must never write into: `~/.e6` for this account and `E6CODE_HOME`. */
export const liveHomes = (): ReadonlyArray<string> => {
  const homes = new Set<string>();
  for (const home of [NodeOS.homedir(), NodeOS.userInfo().homedir]) {
    if (home) homes.add(`${home}/${DATA_DIR_NAME}`);
  }
  const configured = readBrandEnv(process.env, "HOME");
  if (configured !== undefined) homes.add(configured);
  return [...homes];
};

/** Fails unless `baseDir` is outside every live home and holds no database or server descriptor. */
export const assertSeedableBaseDir = Effect.fnUntraced(function* (input: {
  readonly baseDir: string;
  readonly liveHomes: ReadonlyArray<string>;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const baseDir = yield* realPathThroughAncestors(input.baseDir);
  for (const home of input.liveHomes) {
    const live = yield* realPathThroughAncestors(home);
    const relative = path.relative(live, baseDir);
    if (relative === "" || (relative.split(path.sep)[0] !== ".." && !path.isAbsolute(relative))) {
      return yield* new PerfSeedUnsafeHomeError({
        baseDir,
        reason: `it is the live E6 home '${live}' or inside it`,
      });
    }
  }
  const paths = yield* ServerConfig.deriveServerPaths(baseDir, undefined);
  for (const existing of [paths.dbPath, paths.serverRuntimeStatePath]) {
    if (yield* fileSystem.exists(existing).pipe(Effect.orElseSucceed(() => true))) {
      return yield* new PerfSeedUnsafeHomeError({
        baseDir,
        reason: `'${existing}' already exists`,
      });
    }
  }
  return { baseDir, paths };
});

export interface PerfSeedInput extends Omit<PerfSeedOptions, "now" | "workspaceRoot"> {
  readonly baseDir: string;
  readonly workspace: string;
  readonly liveHomes: ReadonlyArray<string>;
}

/** Seeds `baseDir` and reports what it wrote. */
export const seedPerfHome = Effect.fn("seedPerfHome")(function* (input: PerfSeedInput) {
  const { baseDir, paths } = yield* assertSeedableBaseDir(input);
  const workspaceRoot = yield* realPathThroughAncestors(input.workspace);
  const startedAt = yield* Clock.currentTimeMillis;
  const plan = buildPerfSeedPlan({ ...input, now: startedAt, workspaceRoot });
  const runtime = perfSeedRuntimeLayer({ baseDir, cwd: workspaceRoot });
  const maxSequence = yield* Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    let highest = 0;
    for (const command of plan.commands) {
      highest = Math.max(highest, (yield* engine.dispatch(command)).sequence);
    }
    return highest;
  }).pipe(Effect.provide(runtime));
  // Reopening runs the projection bootstrap a server runs at start, which moves the
  // attachment-cleanup cursor up to the last event, so the home boots with nothing to scan.
  yield* OrchestrationEngineService.pipe(Effect.provide(runtime), Effect.asVoid);
  const finishedAt = yield* Clock.currentTimeMillis;
  return {
    durationMs: finishedAt - startedAt,
    baseDir,
    dbPath: paths.dbPath,
    projectId: plan.projectId,
    threads: plan.threads.length,
    longThreadId: plan.threads[0]?.threadId ?? null,
    longThreadTurns: input.longThreadTurns,
    longThreadShape: input.longThreadShape,
    turnsPerThread: input.turnsPerThread,
    commands: plan.commands.length,
    maxSequence,
  };
});

const encodeSummary = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const positiveInteger = (name: string, fallback: number, description: string) =>
  Flag.Int(name).pipe(
    Flag.filter(
      (value) => value >= 1,
      (value) => `--${name} must be at least 1, received ${value}`,
    ),
    Flag.withDefault(fallback),
    Flag.withDescription(description),
  );

const perfSeedCommand = Command.make(
  "perf-seed",
  {
    baseDir: Flag.String("base-dir").pipe(Flag.withDescription("Throwaway E6 home to create.")),
    workspace: Flag.String("workspace").pipe(
      Flag.withDescription("Throwaway git repository the seeded project points at."),
    ),
    threads: positiveInteger("threads", 50, "Threads in the project, the long one included."),
    longThreadTurns: positiveInteger("long-thread-turns", 1_000, "Turns on the long thread."),
    turnsPerThread: positiveInteger("turns-per-thread", 4, "Turns on every other thread."),
    providers: Flag.String("provider").pipe(
      Flag.withDefault("cursor"),
      Flag.withDescription("Provider kind, or a comma-separated list the threads rotate through."),
    ),
    longThreadShape: Flag.Literals("long-thread-shape", ["turns", "imported-messages"]).pipe(
      Flag.withDefault<PerfSeedLongThreadShape>("turns"),
      Flag.withDescription("Write the long thread as turns or as one history import."),
    ),
  },
  (flags) =>
    Effect.gen(function* () {
      const providers = flags.providers
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .map((entry) => ProviderDriverKind.make(entry));
      const summary = yield* seedPerfHome({ ...flags, providers, liveHomes: liveHomes() });
      yield* Console.log(yield* encodeSummary(summary));
    }).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
).pipe(Command.withDescription("Seed a throwaway E6 home for the web performance harness."));

if (import.meta.main) {
  Command.run(perfSeedCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
