/**
 * Small hand-made recordings for adapter contract and replay tests. Each
 * scenario is the least a provider would emit for it, so tests read clearly;
 * realistic load comes from the corpus files.
 *
 * @module provider/testUtils/replayRecordings
 */
import type { ProviderDriverKind } from "@e6tools/contracts";
import type {
  ProviderReplayRecording,
  RecordingLine,
  ReplayScenario,
} from "@e6tools/shared/testing/providerReplay/recording";

export type ContractScenario = "plain" | "approval" | "user-input";

const turnStep = (turnId: string, dt = 0): RecordingLine =>
  ({ kind: "step", dt, on: "sendTurn", turnId, input: `Run ${turnId}.` }) as RecordingLine;

function makeBuilder(provider: ProviderDriverKind) {
  let eventCount = 0;
  const event = (dt: number, fields: Record<string, unknown>): RecordingLine => {
    eventCount += 1;
    return {
      kind: "event",
      dt,
      event: {
        eventId: `e${eventCount}`,
        provider,
        threadId: "thread-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        ...fields,
      },
    } as unknown as RecordingLine;
  };
  const plainTurn = (turnId: string): ReadonlyArray<RecordingLine> => [
    turnStep(turnId, 400),
    event(30, { type: "turn.started", turnId, payload: {} }),
    event(120, {
      type: "content.delta",
      turnId,
      itemId: `${turnId}-msg`,
      payload: { streamKind: "assistant_text", delta: "Hello " },
    }),
    event(45, {
      type: "content.delta",
      turnId,
      itemId: `${turnId}-msg`,
      payload: { streamKind: "assistant_text", delta: "from the replay." },
    }),
    event(10, {
      type: "item.completed",
      turnId,
      itemId: `${turnId}-msg`,
      payload: { itemType: "assistant_message", status: "completed" },
    }),
    event(5, { type: "turn.completed", turnId, payload: { state: "completed" } }),
  ];
  return { event, plainTurn };
}

/** Builds the recording a contract scenario replays, for any provider. */
export function contractRecording(
  provider: ProviderDriverKind,
  scenario: ContractScenario,
): ProviderReplayRecording {
  const { event, plainTurn } = makeBuilder(provider);
  const start: ReadonlyArray<RecordingLine> = [
    { kind: "step", dt: 0, on: "startSession" } as RecordingLine,
    event(80, { type: "session.started", payload: {} }),
  ];
  const scenarios: Record<ContractScenario, ReadonlyArray<ReplayScenario>> = {
    plain: ["streaming-prose"],
    approval: ["approval-flow"],
    "user-input": ["user-input"],
  };
  let body: ReadonlyArray<RecordingLine>;
  switch (scenario) {
    case "plain":
      body = [...plainTurn("turn-1"), ...plainTurn("turn-2")];
      break;
    case "approval":
      body = [
        turnStep("turn-1"),
        event(30, { type: "turn.started", turnId: "turn-1", payload: {} }),
        event(50, {
          type: "item.started",
          turnId: "turn-1",
          itemId: "tool-1",
          payload: { itemType: "command_execution", title: "Run tests" },
        }),
        event(10, {
          type: "request.opened",
          turnId: "turn-1",
          requestId: "req-1",
          payload: { requestType: "command_execution_approval", detail: "npm test" },
        }),
        {
          kind: "step",
          dt: 1_500,
          on: "respondToRequest",
          requestId: "req-1",
          decision: "accept",
        } as RecordingLine,
        event(20, {
          type: "request.resolved",
          turnId: "turn-1",
          requestId: "req-1",
          payload: { requestType: "command_execution_approval", decision: "accept" },
        }),
        event(300, {
          type: "item.completed",
          turnId: "turn-1",
          itemId: "tool-1",
          payload: { itemType: "command_execution", status: "completed", title: "Run tests" },
        }),
        event(5, { type: "turn.completed", turnId: "turn-1", payload: { state: "completed" } }),
      ];
      break;
    case "user-input":
      body = [
        turnStep("turn-1"),
        event(30, { type: "turn.started", turnId: "turn-1", payload: {} }),
        event(60, {
          type: "user-input.requested",
          turnId: "turn-1",
          requestId: "req-1",
          payload: {
            questions: [
              {
                id: "q1",
                header: "Scope",
                question: "Which module first?",
                options: [{ label: "Parser", description: "Start with the parser" }],
              },
            ],
          },
        }),
        {
          kind: "step",
          dt: 2_000,
          on: "respondToUserInput",
          requestId: "req-1",
          answers: { q1: "Parser" },
        } as RecordingLine,
        event(20, {
          type: "user-input.resolved",
          turnId: "turn-1",
          requestId: "req-1",
          payload: { answers: { q1: "Parser" } },
        }),
        event(5, { type: "turn.completed", turnId: "turn-1", payload: { state: "completed" } }),
      ];
      break;
  }
  return {
    header: {
      kind: "header",
      format: "e6.provider-replay",
      version: 1,
      id: `contract.${scenario}`,
      provider,
      scenarios: scenarios[scenario],
      source: "hand-made",
    },
    lines: [...start, ...body],
  };
}
