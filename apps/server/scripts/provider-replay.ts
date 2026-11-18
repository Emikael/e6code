#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - reads the machine's identity and git config to scrub it.
/**
 * Maintainer commands for provider replay recordings.
 *
 *   node apps/server/scripts/provider-replay.ts scrub --in <raw.ndjson> --out <file> \
 *     --workspace <sample project path> --id <id> --scenario <scenario> [--identity <word>]
 *   node apps/server/scripts/provider-replay.ts stats --in <file>
 *
 * `scrub` removes paths, identities and secrets from a raw recording written
 * by the recorder (E6CODE_RECORD_PROVIDER_EVENTS) and refuses to write when
 * the leak check still finds anything. Besides `--identity` words it always
 * scrubs this machine's login and hostname and the global git name and email.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  countEventTypes,
  decodeRecording,
  encodeRecording,
  recordingDurationMs,
  ReplayScenario,
} from "@e6tools/shared/testing/providerReplay/recording";
import { findLeaks, scrubRecording } from "@e6tools/shared/testing/providerReplay/scrub";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/unstable/cli";

class RecordingLeaksError extends Schema.TaggedError<RecordingLeaksError>()("RecordingLeaksError", {
  count: Schema.Int,
}) {
  override get message(): string {
    return `Refusing to write: the leak check found ${this.count} problem(s) after scrubbing.`;
  }
}

const decodeScenarios = Schema.decodeUnknownEffect(Schema.Array(ReplayScenario));

function gitGlobal(key: string): string | undefined {
  try {
    const value = NodeChildProcess.execFileSync("git", ["config", "--global", key], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function realpathOrSelf(path: string): string {
  try {
    return NodeFS.realpathSync.native(path);
  } catch {
    return path;
  }
}

/** The recording machine's identity: login, hostname, git name and email, and name parts. */
function machineIdentities(extra: ReadonlyArray<string>): ReadonlyArray<string> {
  const hostname = NodeOS.hostname();
  const gitName = gitGlobal("user.name");
  // Name parts are matched alone, so short ones ("Ian") would rewrite ordinary words.
  const nameParts = gitName?.split(/\s+/).filter((part) => part.length >= 4) ?? [];
  const values = [
    ...extra,
    NodeOS.userInfo().username,
    hostname,
    hostname.split(".")[0],
    gitName,
    gitGlobal("user.email"),
    ...nameParts,
  ];
  return values.filter(
    (value): value is string =>
      value !== undefined && value.length >= 3 && value.toLowerCase() !== "localhost",
  );
}

const scrubCommand = Command.make(
  "scrub",
  {
    input: Flag.String("in").pipe(Flag.withDescription("Raw recording written by the recorder.")),
    output: Flag.String("out").pipe(Flag.withDescription("Where to write the scrubbed recording.")),
    workspaces: Flag.String("workspace").pipe(
      Flag.atLeast(1),
      Flag.withDescription("Sample project path the session ran in; becomes /workspace/repo."),
    ),
    id: Flag.String("id").pipe(Flag.withDescription("Recording id, e.g. codex.subagent-fleet.")),
    scenarios: Flag.String("scenario").pipe(
      Flag.atLeast(1),
      Flag.withDescription(`One of: ${ReplayScenario.literals.join(", ")}.`),
    ),
    identities: Flag.String("identity").pipe(
      Flag.atLeast(0),
      Flag.withDescription("Extra word to replace with `user` (a name, an org)."),
    ),
    endAtLastTurn: Flag.Boolean("end-at-last-turn").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Drop what was recorded after the last turn ended, such as errors from stopping the server.",
      ),
    ),
  },
  ({ input, output, workspaces, id, scenarios, identities, endAtLastTurn }) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const raw = yield* decodeRecording(yield* fileSystem.readFileString(input));
      const scenarioList = yield* decodeScenarios(scenarios);
      const identityList = machineIdentities(identities);
      const home = NodeOS.homedir();
      const lastTurnEnd = raw.lines.findLastIndex(
        (line) =>
          line.kind === "event" &&
          (line.event.type === "turn.completed" || line.event.type === "turn.aborted"),
      );
      const lines =
        endAtLastTurn && lastTurnEnd >= 0 ? raw.lines.slice(0, lastTurnEnd + 1) : raw.lines;
      const scrubbed = scrubRecording(
        { header: { ...raw.header, id, scenarios: scenarioList }, lines },
        {
          workspaceRoots: workspaces.flatMap((path) => [path, realpathOrSelf(path)]),
          homeDirectories: [home, realpathOrSelf(home)],
          identities: identityList,
        },
      );
      const leaks = findLeaks(scrubbed, { identities: identityList });
      if (leaks.length > 0) {
        for (const leak of leaks) {
          yield* Console.error(`  line ${leak.line}: ${leak.kind} at ${leak.path}`);
        }
        return yield* new RecordingLeaksError({ count: leaks.length });
      }
      const text = encodeRecording(scrubbed);
      // Prove the file decodes before anyone commits it.
      yield* decodeRecording(text);
      yield* fileSystem.writeFileString(output, text);
      yield* Console.log(`Wrote ${output}. Review it as a diff before committing.`);
    }),
).pipe(Command.withDescription("Scrub a raw recording for committing; refuses on any leak."));

const statsCommand = Command.make(
  "stats",
  { input: Flag.String("in").pipe(Flag.withDescription("Recording to summarise.")) },
  ({ input }) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const text = yield* fileSystem.readFileString(input);
      const recording = yield* decodeRecording(text);
      const durationMs = recordingDurationMs(recording);
      const events = recording.lines.filter((line) => line.kind === "event").length;
      const rows = text.split("\n").filter((row) => row.length > 0);
      const largest = Math.max(...rows.map((row) => Buffer.byteLength(row)));
      yield* Console.log(`${recording.header.id} (${recording.header.provider})`);
      yield* Console.log(`  scenarios: ${recording.header.scenarios.join(", ") || "none"}`);
      yield* Console.log(`  duration: ${(durationMs / 1_000).toFixed(1)} s`);
      yield* Console.log(
        `  events: ${events} (${(events / Math.max(durationMs / 1_000, 0.001)).toFixed(1)}/s), steps: ${recording.lines.length - events}`,
      );
      yield* Console.log(`  bytes: ${Buffer.byteLength(text)}, largest line: ${largest}`);
      const counts = [...countEventTypes(recording)].toSorted((left, right) => right[1] - left[1]);
      for (const [type, count] of counts) yield* Console.log(`    ${type}: ${count}`);
    }),
).pipe(Command.withDescription("Summarise a recording: duration, event rate, sizes, types."));

const providerReplayCommand = Command.make("provider-replay").pipe(
  Command.withSubcommands([scrubCommand, statsCommand]),
  Command.withDescription("Scrub and inspect provider replay recordings."),
);

if (import.meta.main) {
  Command.run(providerReplayCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
