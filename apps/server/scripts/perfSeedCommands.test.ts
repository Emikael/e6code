import {
  isImportedAgentSessionMessageId,
  OrchestrationCommand,
  ProviderDriverKind,
} from "@e6tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { buildPerfSeedPlan, type PerfSeedOptions } from "./perfSeedCommands.ts";

const NOW = Date.parse("2026-11-21T12:00:00.000Z");
const cursor = ProviderDriverKind.make("cursor");
const codex = ProviderDriverKind.make("codex");
const decodeCommand = Schema.decodeUnknownEffect(OrchestrationCommand);
const encodeCommand = Schema.encodeEffect(OrchestrationCommand);

const options = (overrides: Partial<PerfSeedOptions> = {}): PerfSeedOptions => ({
  now: NOW,
  workspaceRoot: "/tmp/perf-workspace",
  threads: 3,
  longThreadTurns: 4,
  turnsPerThread: 2,
  providers: [cursor, codex],
  longThreadShape: "turns",
  ...overrides,
});

type Command = OrchestrationCommand;

const threadIdOf = (command: Command) => ("threadId" in command ? command.threadId : undefined);

/** A short label per command: its type, plus the session status for session commands. */
const label = (command: Command) =>
  command.type === "thread.session.set"
    ? `session:${command.session.status}`
    : command.type === "thread.activity.append"
      ? `activity:${command.activity.kind}`
      : command.type;

const timeOf = (command: Command) =>
  Date.parse(
    command.type === "thread.history.import"
      ? command.messages[0]!.createdAt
      : "createdAt" in command
        ? (command.createdAt as string)
        : "",
  );

/** One provider turn in the order ProviderRuntimeIngestion dispatches it (see the module doc). */
const TURN_BODY = [
  "session:running",
  "thread.message.reasoning.delta",
  "thread.message.reasoning.complete",
  "activity:tool.started",
  "activity:tool.updated",
  "activity:tool.completed",
  "activity:tool.started",
  "activity:tool.updated",
  "activity:tool.completed",
  "activity:tool.started",
  "activity:tool.updated",
  "activity:tool.completed",
  "thread.message.assistant.delta",
  "thread.message.assistant.delta",
  "thread.message.assistant.complete",
  "activity:turn.usage",
  "session:ready",
];

describe("buildPerfSeedPlan", () => {
  it.effect("produces only commands the orchestration engine accepts", () =>
    Effect.gen(function* () {
      const plan = buildPerfSeedPlan(options());
      for (const command of plan.commands) {
        expect(yield* encodeCommand(yield* decodeCommand(command))).toEqual(command);
      }
    }),
  );

  it("lays out one long thread and short threads that rotate providers", () => {
    const plan = buildPerfSeedPlan(options());
    expect(plan.threads.map((thread) => [thread.turns, thread.provider, thread.long])).toEqual([
      [4, cursor, true],
      [2, codex, false],
      [2, cursor, false],
    ]);
    expect(plan.commands[0]).toMatchObject({
      type: "project.create",
      projectId: plan.projectId,
      workspaceRoot: "/tmp/perf-workspace",
    });
    for (const thread of plan.threads) {
      const commands = plan.commands.filter((command) => threadIdOf(command) === thread.threadId);
      expect(commands[0]).toMatchObject({
        type: "thread.create",
        projectId: plan.projectId,
        modelSelection: { instanceId: thread.provider },
      });
      expect(commands.filter((command) => command.type === "thread.turn.start")).toHaveLength(
        thread.turns,
      );
    }
  });

  it("dispatches each turn the way provider ingestion would, and stops every session", () => {
    const plan = buildPerfSeedPlan(options());
    const long = plan.threads[0]!;
    const labels = plan.commands
      .filter((command) => threadIdOf(command) === long.threadId)
      .map(label);

    // The reactor marks the session starting for every turn, and binds the
    // provider session with a second starting record on the first.
    const firstTurn = ["thread.turn.start", "session:starting", "session:starting", ...TURN_BODY];
    const laterTurn = ["thread.turn.start", "session:starting", ...TURN_BODY];
    expect(labels).toEqual([
      "thread.create",
      ...firstTurn,
      ...laterTurn,
      ...laterTurn,
      ...laterTurn,
      "session:stopped",
    ]);

    for (const thread of plan.threads) {
      const last = plan.commands.findLast((command) => threadIdOf(command) === thread.threadId);
      expect(last).toMatchObject({
        type: "thread.session.set",
        session: { status: "stopped", activeTurnId: null },
      });
    }
    // Turn starts, running and ready records name the same turn.
    const running = plan.commands.filter(
      (command) =>
        command.type === "thread.session.set" &&
        command.threadId === long.threadId &&
        command.session.status === "running",
    );
    expect(
      new Set(
        running.map(
          (command) => command.type === "thread.session.set" && command.session.activeTurnId,
        ),
      ).size,
    ).toBe(4);
  });

  it("keeps ids unique, outside reserved namespaces, and timestamps in dispatch order", () => {
    const plan = buildPerfSeedPlan(options({ threads: 5, longThreadTurns: 6 }));
    const commandIds = plan.commands.map((command) => command.commandId);
    expect(new Set(commandIds).size).toBe(commandIds.length);

    const messageIds = plan.commands.flatMap((command) =>
      command.type === "thread.turn.start"
        ? [command.message.messageId]
        : command.type === "thread.message.assistant.complete" ||
            command.type === "thread.message.reasoning.complete"
          ? [command.messageId]
          : [],
    );
    expect(new Set(messageIds).size).toBe(messageIds.length);
    expect(messageIds.some(isImportedAgentSessionMessageId)).toBe(false);

    const activityIds = plan.commands.flatMap((command) =>
      command.type === "thread.activity.append" ? [command.activity.id] : [],
    );
    expect(new Set(activityIds).size).toBe(activityIds.length);

    const times = plan.commands.map(timeOf);
    expect(times.every((time) => Number.isFinite(time))).toBe(true);
    expect(times).toEqual(times.toSorted((left, right) => left - right));
    // Recent, so nothing auto-settles, but outside the queued-turn grace window.
    expect(Math.max(...times)).toBeLessThanOrEqual(NOW - 2 * 60_000);
    expect(Math.min(...times)).toBeGreaterThan(NOW - 24 * 60 * 60_000);
  });

  it("can import the long thread as plain messages instead of turns", () => {
    const plan = buildPerfSeedPlan(options({ longThreadShape: "imported-messages" }));
    const long = plan.threads[0]!;
    const commands = plan.commands.filter((command) => threadIdOf(command) === long.threadId);
    expect(commands.map((command) => command.type)).toEqual([
      "thread.create",
      "thread.history.import",
    ]);
    const imported = commands[1]!;
    expect(
      imported.type === "thread.history.import" && imported.messages.map((message) => message.role),
    ).toEqual(["user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant"]);
    // The short threads keep their turns.
    expect(plan.commands.filter((command) => command.type === "thread.turn.start")).toHaveLength(4);
  });
});
