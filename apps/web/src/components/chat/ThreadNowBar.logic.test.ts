import { TurnId } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "../../session-logic";
import {
  earlierTurnDurations,
  countChangedFiles,
  deriveNowBarState,
  doneSummary,
  formatNowBarElapsed,
  selectCurrentAction,
  selectRetryMessage,
  type NowBarInput,
} from "./ThreadNowBar.logic";

const idle: NowBarInput = {
  isWorking: false,
  workStartedAt: null,
  planProgress: null,
  agentState: null,
  currentAction: null,
  pendingApprovals: [],
  pendingUserInputs: [],
  provider: "Codex",
  failure: null,
  latestTurn: null,
};

const working = (overrides: Partial<NowBarInput> = {}): NowBarInput => ({
  ...idle,
  isWorking: true,
  workStartedAt: "2026-11-11T14:02:00.000Z",
  latestTurn: {
    state: "running",
    startedAt: "2026-11-11T14:02:00.000Z",
    completedAt: null,
  },
  ...overrides,
});

describe("deriveNowBarState", () => {
  it("is hidden before the first turn and after a stop", () => {
    expect(deriveNowBarState(idle)).toEqual({ kind: "hidden" });
    expect(
      deriveNowBarState({
        ...idle,
        latestTurn: {
          state: "interrupted",
          startedAt: "2026-11-11T14:02:00.000Z",
          completedAt: "2026-11-11T14:03:00.000Z",
        },
      }),
    ).toEqual({ kind: "hidden" });
  });

  it("shows the plan step and meter while the agent reports a plan", () => {
    expect(
      deriveNowBarState(
        working({
          planProgress: { step: "Updating the token map", completedSteps: 2, totalSteps: 5 },
          currentAction: "Running vp",
        }),
      ),
    ).toEqual({
      kind: "working",
      status: "Working",
      live: true,
      progress: { completedSteps: 2, totalSteps: 5 },
      text: "Step 3 of 5 · Updating the token map",
      startedAt: "2026-11-11T14:02:00.000Z",
    });
  });

  it("falls back to the current action without a plan, as for OpenCode", () => {
    const state = deriveNowBarState(working({ currentAction: "Editing themePalettes.ts" }));
    expect(state).toMatchObject({
      kind: "working",
      status: "Working",
      progress: null,
      text: "Editing themePalettes.ts",
    });
  });

  it("names a stall in neutral words instead of the plan", () => {
    const state = deriveNowBarState(
      working({
        agentState: { kind: "retrying", attempt: 2, maxAttempts: 10 },
        planProgress: { step: "Updating", completedSteps: 1, totalSteps: 3 },
      }),
    );
    expect(state).toMatchObject({
      kind: "working",
      status: "Retrying",
      live: false,
      progress: null,
      text: "attempt 2 of 10",
    });
  });

  it("puts a request blocked on you first, aged from the oldest one", () => {
    const state = deriveNowBarState(
      working({
        pendingApprovals: [
          { requestKind: "command", createdAt: "2026-11-11T14:05:00.000Z" },
          { requestKind: "command", createdAt: "2026-11-11T14:04:00.000Z" },
        ],
      }),
    );
    expect(state).toEqual({
      kind: "blocked",
      request: "approval",
      text: "Codex wants to run 2 commands",
      since: "2026-11-11T14:04:00.000Z",
    });
  });

  it("quotes the first question an agent asks", () => {
    const state = deriveNowBarState(
      working({
        provider: "Claude",
        pendingUserInputs: [
          {
            createdAt: "2026-11-11T14:04:00.000Z",
            questions: [{ question: "keep the spring animation, or cut to a fade?" }],
          },
        ],
      }),
    );
    expect(state).toMatchObject({
      kind: "blocked",
      request: "input",
      text: "Claude asks 1 question: keep the spring animation, or cut to a fade?",
    });
  });

  it("gives the failure reason once work stops", () => {
    expect(
      deriveNowBarState({ ...idle, failure: "Codex stopped: the CLI is not signed in" }),
    ).toEqual({ kind: "failed", text: "Codex stopped: the CLI is not signed in" });
  });

  it("says how long a finished turn worked and whether it changed anything", () => {
    const finished = (diffStat?: { insertions: number; deletions: number }) =>
      deriveNowBarState({
        ...idle,
        latestTurn: {
          state: "completed",
          startedAt: "2026-11-11T14:02:20.000Z",
          completedAt: "2026-11-11T14:06:00.000Z",
          diffStat,
        },
      });
    expect(finished({ insertions: 4, deletions: 4 })).toEqual({
      kind: "done",
      workedFor: "3m 40s",
      finishedAt: "2026-11-11T14:06:00.000Z",
      hasChanges: true,
    });
    expect(finished()).toMatchObject({ kind: "done", hasChanges: false });
  });
});

describe("formatNowBarElapsed", () => {
  const start = "2026-11-11T14:02:00.000Z";
  const at = (ms: number) => Date.parse(start) + ms;

  it("counts seconds, then minutes and seconds, then hours", () => {
    expect(formatNowBarElapsed(start, at(42_000))).toEqual({ elapsed: "42s" });
    expect(formatNowBarElapsed(start, at(130_000))).toEqual({ elapsed: "2m 10s" });
    expect(formatNowBarElapsed(start, at(3_725_000))).toEqual({ elapsed: "1h 2m 5s" });
  });

  it("names the day past 24 hours instead of growing", () => {
    expect(formatNowBarElapsed(start, at(26 * 3_600_000))).toHaveProperty("day");
  });

  it("returns null for an unreadable start", () => {
    expect(formatNowBarElapsed("not a date", Date.now())).toBeNull();
  });
});

describe("doneSummary", () => {
  it("reads like the board", () => {
    expect(doneSummary("3m 40s", "14:06")).toBe("Worked 3m 40s · finished 14:06");
    expect(doneSummary(null, "14:06")).toBe("Finished 14:06");
  });
});

const entry = (overrides: Partial<WorkLogEntry>): WorkLogEntry => ({
  id: overrides.id ?? "entry",
  createdAt: "2026-11-11T14:02:00.000Z",
  label: "tool",
  tone: "tool",
  ...overrides,
});

describe("selectCurrentAction", () => {
  const turn = TurnId.make("turn-2");

  it("takes the running turn's latest tool step", () => {
    const entries = [
      entry({ id: "a", turnId: TurnId.make("turn-1"), command: "git status" }),
      entry({ id: "b", turnId: turn, command: "vp test run", toolLifecycleStatus: "inProgress" }),
      entry({ id: "c", turnId: turn, tone: "thinking", label: "Thinking" }),
    ];
    expect(selectCurrentAction(entries, turn, undefined)).toBe("Running vp");
  });

  it("is null without a running turn or before any tool step", () => {
    expect(selectCurrentAction([entry({ turnId: turn })], null, undefined)).toBeNull();
    expect(
      selectCurrentAction([entry({ turnId: turn, tone: "thinking" })], turn, undefined),
    ).toBeNull();
  });
});

describe("countChangedFiles", () => {
  it("counts each file once across turns and the running turn", () => {
    const file = (path: string) => ({ path, kind: "modified", additions: 1, deletions: 0 });
    expect(
      countChangedFiles(
        [{ files: [file("a.ts"), file("b.ts")] }, { files: [file("a.ts")] }],
        [{ changedFiles: ["/repo/b.ts", "/repo/c.ts"] }, {}],
        "/repo",
      ),
    ).toBe(3);
  });
});

describe("selectRetryMessage", () => {
  const failedTurn = { turnId: TurnId.make("turn-2"), state: "error" };
  const asked = (turnId: string | null, text = "Fix the relay test") => ({
    role: "user",
    text,
    turnId: turnId === null ? null : TurnId.make(turnId),
  });
  const answer = (turnId: string) => ({
    role: "assistant",
    text: "Done.",
    turnId: TurnId.make(turnId),
  });

  it("retries your message from the turn that failed", () => {
    const message = asked("turn-2");
    expect(selectRetryMessage([asked("turn-1"), answer("turn-1"), message], failedTurn)).toBe(
      message,
    );
  });

  it("offers nothing when the latest turn completed, even if the session errored later", () => {
    expect(
      selectRetryMessage([asked("turn-2"), answer("turn-2")], {
        turnId: TurnId.make("turn-2"),
        state: "completed",
      }),
    ).toBeNull();
  });

  it("offers nothing when your last message belongs to an earlier, answered turn", () => {
    expect(selectRetryMessage([asked("turn-1"), answer("turn-1")], failedTurn)).toBeNull();
  });

  it("retries a message not yet bound to a turn when nothing answered it", () => {
    const message = asked(null);
    expect(selectRetryMessage([asked("turn-1"), answer("turn-1"), message], failedTurn)).toBe(
      message,
    );
  });

  it("offers nothing for an unbound message that another turn answered", () => {
    expect(selectRetryMessage([asked(null), answer("turn-1")], failedTurn)).toBeNull();
  });

  it("offers nothing for a message with attachments", () => {
    expect(
      selectRetryMessage([{ ...asked("turn-2"), attachments: [{ id: "image" }] }], failedTurn),
    ).toBeNull();
  });
});

describe("earlierTurnDurations", () => {
  const message = (
    role: "user" | "assistant",
    turnId: string | null,
    createdAt: string,
    updatedAt = createdAt,
  ) => ({
    role,
    turnId: turnId === null ? null : TurnId.make(turnId),
    createdAt: `2026-11-12T${createdAt}Z`,
    updatedAt: `2026-11-12T${updatedAt}Z`,
  });

  it("lists finished turns oldest first, leaving out the running one", () => {
    const messages = [
      message("user", null, "09:00:00"),
      message("assistant", "t1", "09:01:00", "09:04:10"),
      message("user", null, "09:10:00"),
      message("assistant", "t2", "09:10:05", "09:10:40"),
      message("user", null, "09:20:00"),
      message("assistant", "t3", "09:20:05", "09:21:00"),
    ];
    expect(earlierTurnDurations(messages, TurnId.make("t3"))).toBe("Earlier turns: 4m, 40s");
  });

  it("says nothing before a turn has finished", () => {
    expect(earlierTurnDurations([message("user", null, "09:00:00")], null)).toBeNull();
  });
});
