/**
 * The orchestration commands that seed a web performance harness home: one
 * project, one long thread and many short ones. `perf-seed.ts` dispatches them
 * through the real engine, so the event log, projections and projection cursors
 * agree and a server started on the home has nothing to replay.
 *
 * Each turn is dispatched in the order a live turn produces, as observed through
 * the orchestration integration harness and read from `ProviderCommandReactor`
 * and `ProviderRuntimeIngestion`:
 *
 *   thread.turn.start                          the client's send
 *   thread.session.set starting                reactor: pending turn start; on a thread's
 *                                              first turn a second one binds the session
 *   thread.session.set running                 ingestion of turn.started
 *   thread.message.reasoning.delta, .complete  ingestion of reasoning text
 *   thread.activity.append ×3 per tool         tool.started, tool.updated, tool.completed
 *   thread.message.assistant.delta ×2, .complete
 *   thread.activity.append turn.usage          ingestion of the final token usage
 *   thread.session.set ready                   ingestion of turn.completed
 *
 * Every thread then ends with the `stopped` session the reactor records after a
 * session stop, so startup has no starting or running session to recover. The
 * checkpoint the live CheckpointReactor adds per turn (thread.turn.diff.complete
 * and its activity) is left out, because it names a git ref the seed does not
 * create. Command ids keep the live prefixes because projections read them.
 *
 * Seeded events never reach provider reactors: those follow live events only.
 *
 * @module scripts/perfSeedCommands
 */
import {
  CommandId,
  defaultInstanceIdForDriver,
  EventId,
  MessageId,
  type OrchestrationCommand,
  ProjectId,
  type ProviderDriverKind,
  ThreadId,
  TurnId,
} from "@e6tools/contracts";
import * as DateTime from "effect/DateTime";

import { defaultReplayModelSlug } from "../src/provider/replay/ReplayProviderDriver.ts";

export type PerfSeedLongThreadShape = "turns" | "imported-messages";

export interface PerfSeedOptions {
  /** Epoch milliseconds the seed is laid out against; every timestamp is before it. */
  readonly now: number;
  readonly workspaceRoot: string;
  /** All threads, the long one included. */
  readonly threads: number;
  readonly longThreadTurns: number;
  /** Turns on each thread other than the long one. */
  readonly turnsPerThread: number;
  /** Provider kinds threads rotate through; the long thread uses the first. */
  readonly providers: ReadonlyArray<ProviderDriverKind>;
  /** "imported-messages" writes the long thread as one history import instead of turns. */
  readonly longThreadShape: PerfSeedLongThreadShape;
}

export interface PerfSeedThread {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly provider: ProviderDriverKind;
  readonly turns: number;
  readonly long: boolean;
}

export interface PerfSeedPlan {
  readonly projectId: ProjectId;
  readonly threads: ReadonlyArray<PerfSeedThread>;
  /** In dispatch order, which is also timestamp order. */
  readonly commands: ReadonlyArray<OrchestrationCommand>;
}

const PROJECT_ID = ProjectId.make("perf-seed-project");
const TURN_SPACING_MS = 30_000;
const THREAD_END_SPACING_MS = 3 * 60_000;
/** Longer than the two-minute window in which a recent user message counts as a queued turn. */
const QUIET_BEFORE_NOW_MS = 5 * 60_000;
const RUNTIME_MODE = "full-access" as const;

const USER_PROMPTS = [
  "Find why the timeline jumps when an older page loads and fix it.",
  "Add a test for the reconnect backoff and make it pass.",
  "Explain how thread detail paging decides the first window.",
  "Rename the stale settings key and migrate existing values.",
  "Profile the sidebar render and remove the extra work you find.",
  "Review the last change for edge cases around empty projects.",
  "Make the command palette keep its query after closing.",
  "Tighten the WebSocket payload for live activity rows.",
];

const REASONING = [
  "The user wants the root cause first. I should read the paging code before changing anything.",
  "There is a test suite for this module; running it first tells me what already holds.",
  "The change touches persisted data, so it needs a migration and a test that reads old rows.",
  "Measuring before editing keeps me from optimising the wrong path.",
  "I will check the callers before renaming, since the key crosses the wire.",
  "Empty projects take a separate branch in the loader; that is the likely gap.",
];

const SENTENCES = [
  "The window is computed from the newest user turn backwards, so an older page only ever prepends rows.",
  "I traced the jump to the scroll anchor being read after the new rows were measured instead of before.",
  "Reading the anchor first and restoring it after layout keeps the visible row in place.",
  "The existing suite already covered the happy path, so I added a case for a page that arrives mid-scroll.",
  "Nothing else reads this value, which keeps the change local to the timeline module.",
  "I left the paging size alone because the server and the client agree on it today.",
  "The test now fails without the fix and passes with it, and the rest of the suite is unchanged.",
  "One caveat: very tall rows still shift by a pixel on high-DPI displays because of rounding.",
  "If you want, I can follow up with a guard for that rounding case in a separate change.",
  "I kept the public API the same, so no client needs to change with this.",
];

const FILES = [
  "src/state/threads.ts",
  "src/components/chat/MessagesTimeline.tsx",
  "src/rpc/session.ts",
  "src/orchestration/projector.ts",
  "src/settings/migrate.ts",
  "src/components/Sidebar.tsx",
  "src/hooks/useScrollAnchor.ts",
  "test/threads.test.ts",
];

const COMMANDS = [
  "vp test run src/state/threads.test.ts",
  "rg -n scrollAnchor src",
  "vp lint src/state/threads.ts",
  "git diff --stat",
  "vp run typecheck",
];

const pick = <A>(values: ReadonlyArray<A>, index: number): A => values[index % values.length]!;

const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));

function assistantText(turn: number): ReadonlyArray<string> {
  const paragraphs = 2 + (turn % 3);
  const parts: Array<string> = [];
  for (let paragraph = 0; paragraph < paragraphs; paragraph += 1) {
    const sentences = [0, 1, 2].map((offset) => pick(SENTENCES, turn + paragraph * 3 + offset));
    parts.push(sentences.join(" "));
  }
  if (turn % 5 === 0) {
    parts.push(
      [
        "```ts",
        `const anchor = readScrollAnchor(list); // turn ${turn + 1}`,
        "await list.prepend(page);",
        "restoreScrollAnchor(list, anchor);",
        "```",
      ].join("\n"),
    );
  }
  const middle = Math.ceil(parts.length / 2);
  return [`${parts.slice(0, middle).join("\n\n")}\n\n`, parts.slice(middle).join("\n\n")];
}

function shellOutput(turn: number, command: string): string {
  const lines = [`$ ${command}`];
  for (let line = 0; line < 24; line += 1) {
    lines.push(
      ` ✓ ${pick(FILES, turn + line)} > case ${line + 1} keeps the anchor (${(line * 7 + turn) % 40} ms)`,
    );
  }
  lines.push(` Test Files  1 passed (1)`, `      Tests  24 passed (24)`);
  return lines.join("\n");
}

interface ToolActivity {
  readonly kind: "tool.started" | "tool.updated" | "tool.completed";
  readonly summary: string;
  readonly payload: Record<string, unknown>;
}

/** Tool lifecycles in the shapes ingestion projects from the recorded opencode session. */
function toolActivities(
  turn: number,
  tool: number,
  toolCallId: string,
): ReadonlyArray<ToolActivity> {
  const file = pick(FILES, turn + tool);
  switch ((turn + tool) % 3) {
    case 0: {
      const base = { itemType: "dynamic_tool_call", toolCallId, title: "read" };
      return [
        {
          kind: "tool.started",
          summary: "read started",
          payload: { ...base, status: "inProgress" },
        },
        {
          kind: "tool.updated",
          summary: "read",
          payload: { ...base, status: "inProgress", data: {} },
        },
        {
          kind: "tool.completed",
          summary: "read",
          payload: {
            ...base,
            status: "completed",
            detail: `Read ${file}, lines 1-${80 + ((turn * 13) % 160)}`,
            data: { tool: "read" },
          },
        },
      ];
    }
    case 1: {
      const command = pick(COMMANDS, turn + tool);
      const output = shellOutput(turn, command);
      const base = { itemType: "command_execution", toolCallId, title: "shell" };
      return [
        {
          kind: "tool.started",
          summary: "shell started",
          payload: { ...base, status: "inProgress" },
        },
        {
          kind: "tool.updated",
          summary: "shell",
          payload: { ...base, status: "inProgress", data: { command } },
        },
        {
          kind: "tool.completed",
          summary: "shell",
          payload: {
            ...base,
            status: "completed",
            detail: `${output.slice(0, 400)}...`,
            data: { tool: "shell", command, result: output },
          },
        },
      ];
    }
    default: {
      const base = { itemType: "file_change", toolCallId, title: "edit" };
      const oldString = `const anchor = list.scrollTop; // ${turn}`;
      const newString = `const anchor = readScrollAnchor(list); // ${turn}\nif (anchor === null) return;`;
      return [
        {
          kind: "tool.started",
          summary: "edit started",
          payload: { ...base, status: "inProgress" },
        },
        {
          kind: "tool.updated",
          summary: "edit",
          payload: { ...base, status: "inProgress", data: { files: [{ path: file }] } },
        },
        {
          kind: "tool.completed",
          summary: "edit",
          payload: {
            ...base,
            status: "completed",
            detail: `Edited ${file} (1 replacement)`,
            data: { tool: "edit", input: { path: file, oldString, newString } },
            changedFiles: [{ path: file, additions: 2, deletions: 1 }],
          },
        },
      ];
    }
  }
}

interface Timed {
  readonly at: number;
  readonly command: OrchestrationCommand;
}

/** One thread's commands; `imported` writes its history as a single import instead of turns. */
function threadCommands(
  thread: PerfSeedThread,
  endAt: number,
  imported: boolean,
): ReadonlyArray<Timed> {
  const { threadId, provider } = thread;
  const instanceId = defaultInstanceIdForDriver(provider);
  const modelSelection = { instanceId, model: defaultReplayModelSlug(provider) };
  const firstTurnAt = endAt - thread.turns * TURN_SPACING_MS;
  const out: Array<Timed> = [];
  const push = (at: number, command: OrchestrationCommand) => out.push({ at, command });
  const session = (
    status: "starting" | "running" | "ready" | "stopped",
    activeTurnId: TurnId | null,
    at: number,
  ) => ({
    threadId,
    status,
    providerName: provider,
    providerInstanceId: instanceId,
    runtimeMode: RUNTIME_MODE,
    activeTurnId,
    lastError: null,
    updatedAt: iso(at),
  });
  /** A session record written by the reactor, under its `server:provider-session-set:` id prefix. */
  const reactorSession = (key: string, at: number, status: "starting" | "stopped") =>
    push(at, {
      type: "thread.session.set",
      commandId: CommandId.make(`server:provider-session-set:perf-seed:${threadId}:${key}`),
      threadId,
      session: session(status, null, at),
      createdAt: iso(at),
    });

  const createdAt = firstTurnAt - 60_000;
  push(createdAt, {
    type: "thread.create",
    commandId: CommandId.make(`perf-seed:${threadId}:create`),
    threadId,
    projectId: PROJECT_ID,
    title: thread.title,
    modelSelection,
    runtimeMode: RUNTIME_MODE,
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt: iso(createdAt),
    ...(imported ? { historyImport: true as const } : {}),
  });

  if (imported) {
    const messages = [];
    for (let turn = 0; turn < thread.turns; turn += 1) {
      const at = firstTurnAt + turn * TURN_SPACING_MS;
      messages.push(
        {
          messageId: MessageId.make(`perf-seed-user:${threadId}:${turn}`),
          role: "user" as const,
          text: pick(USER_PROMPTS, turn),
          createdAt: iso(at),
        },
        {
          messageId: MessageId.make(`perf-seed-assistant:${threadId}:${turn}`),
          role: "assistant" as const,
          text: assistantText(turn).join(""),
          createdAt: iso(at + 15_000),
        },
      );
    }
    push(firstTurnAt, {
      type: "thread.history.import",
      commandId: CommandId.make(`perf-seed:${threadId}:history-import`),
      threadId,
      messages: messages as [(typeof messages)[number], ...Array<(typeof messages)[number]>],
    });
    return out;
  }

  for (let turn = 0; turn < thread.turns; turn += 1) {
    const startAt = firstTurnAt + turn * TURN_SPACING_MS;
    const turnId = TurnId.make(`perf-seed-turn:${threadId}:${turn}`);
    let eventCount = 0;
    /** The provider event an ingestion command derives from; its id prefixes the command id. */
    const providerEvent = (tag: string) => {
      eventCount += 1;
      const eventId = `perf-seed-event:${threadId}:${turn}:${eventCount}`;
      return {
        eventId: EventId.make(eventId),
        commandId: CommandId.make(`provider:${eventId}:${tag}:seed`),
      };
    };

    push(startAt, {
      type: "thread.turn.start",
      commandId: CommandId.make(`perf-seed:${threadId}:turn:${turn}`),
      threadId,
      message: {
        messageId: MessageId.make(`perf-seed-user:${threadId}:${turn}`),
        role: "user",
        text: pick(USER_PROMPTS, turn + thread.turns),
        attachments: [],
      },
      modelSelection,
      runtimeMode: RUNTIME_MODE,
      interactionMode: "default",
      createdAt: iso(startAt),
    });
    reactorSession(`turn:${turn}:pending`, startAt, "starting");
    if (turn === 0) reactorSession(`turn:${turn}:bind`, startAt + 200, "starting");

    const runningAt = startAt + 800;
    push(runningAt, {
      type: "thread.session.set",
      commandId: providerEvent("thread-session-set").commandId,
      threadId,
      session: session("running", turnId, runningAt),
      createdAt: iso(runningAt),
    });

    const reasoningId = MessageId.make(`reasoning:raw:${turnId}`);
    push(startAt + 1_200, {
      type: "thread.message.reasoning.delta",
      commandId: providerEvent("reasoning-delta-buffer-spill").commandId,
      threadId,
      messageId: reasoningId,
      delta: pick(REASONING, turn),
      turnId,
      createdAt: iso(startAt + 1_200),
    });
    push(startAt + 2_000, {
      type: "thread.message.reasoning.complete",
      commandId: providerEvent("reasoning-complete-on-tool-start").commandId,
      threadId,
      messageId: reasoningId,
      turnId,
      createdAt: iso(startAt + 2_000),
    });

    for (let tool = 0; tool < 3; tool += 1) {
      const toolAt = startAt + 2_000 + tool * 3_000;
      const toolCallId = `perf-seed-call:${threadId}:${turn}:${tool}`;
      toolActivities(turn, tool, toolCallId).forEach((activity, step) => {
        const at = toolAt + [0, 500, 2_000][step]!;
        const event = providerEvent("thread-activity-append");
        push(at, {
          type: "thread.activity.append",
          commandId: event.commandId,
          threadId,
          activity: {
            id: event.eventId,
            tone: "tool",
            kind: activity.kind,
            summary: activity.summary,
            payload: activity.payload,
            turnId,
            createdAt: iso(at),
          },
          createdAt: iso(at),
        });
      });
    }

    const assistantId = MessageId.make(`assistant:${turnId}:segment:0`);
    const [firstHalf, secondHalf] = assistantText(turn);
    push(startAt + 12_000, {
      type: "thread.message.assistant.delta",
      commandId: providerEvent("assistant-delta-buffer-spill").commandId,
      threadId,
      messageId: assistantId,
      delta: firstHalf!,
      turnId,
      createdAt: iso(startAt + 12_000),
    });
    push(startAt + 14_000, {
      type: "thread.message.assistant.delta",
      commandId: providerEvent("assistant-delta-buffer-spill").commandId,
      threadId,
      messageId: assistantId,
      delta: secondHalf!,
      turnId,
      createdAt: iso(startAt + 14_000),
    });
    const endTurnAt = startAt + 15_000;
    push(endTurnAt, {
      type: "thread.message.assistant.complete",
      commandId: providerEvent("assistant-complete-finalize").commandId,
      threadId,
      messageId: assistantId,
      turnId,
      createdAt: iso(endTurnAt),
    });
    const inputTokens = 24_000 + turn * 1_850;
    push(endTurnAt, {
      type: "thread.activity.append",
      commandId: providerEvent("thread-activity-append").commandId,
      threadId,
      activity: {
        id: EventId.make(`turn-usage:${threadId}:${turnId}`),
        tone: "info",
        kind: "turn.usage",
        summary: "Turn usage",
        payload: {
          totalTokens: inputTokens + 1_200,
          inputTokens,
          outputTokens: 1_200,
          cachedInputTokens: Math.floor(inputTokens * 0.8),
          cacheCreationTokens: 0,
          reasoningTokens: 400,
          partial: false,
        },
        turnId,
        createdAt: iso(endTurnAt),
      },
      createdAt: iso(endTurnAt),
    });
    push(endTurnAt, {
      type: "thread.session.set",
      commandId: providerEvent("thread-session-set").commandId,
      threadId,
      session: session("ready", null, endTurnAt),
      createdAt: iso(endTurnAt),
    });
  }
  reactorSession("stop", endAt, "stopped");
  return out;
}

/** Lays out the seed and returns every command to dispatch, oldest first. */
export function buildPerfSeedPlan(options: PerfSeedOptions): PerfSeedPlan {
  if (options.providers.length === 0) throw new Error("perf seed needs at least one provider");
  const threads: Array<PerfSeedThread> = [];
  for (let index = 0; index < options.threads; index += 1) {
    const long = index === 0;
    const turns = long ? options.longThreadTurns : options.turnsPerThread;
    const thread: PerfSeedThread = {
      threadId: ThreadId.make(`perf-seed-thread-${String(index + 1).padStart(2, "0")}`),
      title: long
        ? `Long thread (${turns} turns)`
        : `${pick(USER_PROMPTS, index).replace(/\.$/, "")} (${index + 1})`,
      provider: pick(options.providers, index),
      turns,
      long,
    };
    threads.push(thread);
  }

  const timed = threads.flatMap((thread, index) =>
    threadCommands(
      thread,
      options.now - QUIET_BEFORE_NOW_MS - index * THREAD_END_SPACING_MS,
      thread.long && thread.turns > 0 && options.longThreadShape === "imported-messages",
    ),
  );
  // A reduce, not a spread: the command count grows with the seed, and a call takes a bounded
  // number of arguments.
  const firstAt = timed.reduce((earliest, entry) => Math.min(earliest, entry.at), options.now);
  const projectAt = firstAt - 60_000;
  const commands = [
    {
      at: projectAt,
      command: {
        type: "project.create",
        commandId: CommandId.make("perf-seed:project:create"),
        projectId: PROJECT_ID,
        title: "Perf seed",
        workspaceRoot: options.workspaceRoot,
        createdAt: iso(projectAt),
      } satisfies OrchestrationCommand,
    },
    ...timed,
  ]
    // Stable, so commands at the same instant keep their per-thread order.
    .toSorted((left, right) => left.at - right.at)
    .map((entry) => entry.command);

  return { projectId: PROJECT_ID, threads, commands };
}
