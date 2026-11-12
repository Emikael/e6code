// @effect-diagnostics globalDate:off -- Fixtures are built on the local calendar.
import { EnvironmentId, ProjectId, ThreadId, TurnId } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { localStartOfDayMs, selectDoneToday, type DoneTodayShell } from "./doneToday.ts";

const LOCAL = EnvironmentId.make("local");
const REMOTE = EnvironmentId.make("remote");

/** Local times on 12 Nov 2026, so the midnight boundary follows the test machine's zone. */
const at = (hours: number, minutes = 0, day = 12) =>
  new Date(2026, 10, day, hours, minutes).toISOString();
const START = localStartOfDayMs(Date.parse(at(15)));

function shell(
  id: string,
  overrides: Partial<DoneTodayShell> & {
    readonly turn?: {
      state: "running" | "completed" | "error" | "interrupted";
      at: string | null;
      diffStat?: { insertions: number; deletions: number };
    };
  } = {},
): DoneTodayShell {
  const { turn, ...rest } = overrides;
  return {
    id: ThreadId.make(id),
    environmentId: LOCAL,
    projectId: ProjectId.make("project"),
    title: id,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    pullRequests: [],
    latestTurn: turn
      ? {
          turnId: TurnId.make(`turn-${id}`),
          state: turn.state,
          requestedAt: at(8),
          startedAt: at(8),
          completedAt: turn.at,
          assistantMessageId: null,
          ...(turn.diffStat ? { diffStat: turn.diffStat } : {}),
        }
      : null,
    ...rest,
  };
}

describe("localStartOfDayMs", () => {
  it("is local midnight", () => {
    expect(new Date(START).getHours()).toBe(0);
    expect(new Date(START).getDate()).toBe(12);
  });
});

describe("selectDoneToday", () => {
  it("lists threads settled or finished since local midnight, newest first", () => {
    const rows = selectDoneToday(
      [
        shell("settled-morning", { settledAt: at(9, 40), settledOverride: "settled" }),
        shell("finished-afternoon", {
          turn: { state: "completed", at: at(14, 6), diffStat: { insertions: 66, deletions: 13 } },
        }),
        shell("yesterday", { turn: { state: "completed", at: at(23, 50, 11) } }),
        shell("just-before-midnight", { settledAt: at(23, 59, 11) }),
      ],
      { startOfDayMs: START },
    );
    expect(rows.map((row) => [row.thread.id, row.how])).toEqual([
      ["finished-afternoon", "finished"],
      ["settled-morning", "settled"],
    ]);
    expect(rows[0]?.diffStat).toEqual({ insertions: 66, deletions: 13 });
    expect(rows[1]?.diffStat).toBeNull();
  });

  it("shows one row per thread, named by its later event", () => {
    const [row, ...rest] = selectDoneToday(
      [
        shell("both", {
          settledAt: at(14, 20),
          turn: { state: "completed", at: at(14, 6) },
        }),
      ],
      { startOfDayMs: START },
    );
    expect(rest).toEqual([]);
    expect(row?.how).toBe("settled");
    expect(row?.doneAt).toBe(at(14, 20));
  });

  it("lists a thread archived today, by its archive time", () => {
    const rows = selectDoneToday(
      [
        shell("archived-today", { archivedAt: at(11), settledAt: at(10) }),
        shell("archived-yesterday", {
          archivedAt: at(18, 0, 11),
          turn: { state: "completed", at: at(10) },
        }),
      ],
      { startOfDayMs: START },
    );
    expect(rows.map((row) => [row.thread.id, row.how, row.doneAt])).toEqual([
      ["archived-today", "archived", at(11)],
    ]);
  });

  it("leaves out failed and stopped turns, running ones and unsettled ones", () => {
    expect(
      selectDoneToday(
        [
          shell("failed", { turn: { state: "error", at: at(10) } }),
          shell("stopped", { turn: { state: "interrupted", at: at(10) } }),
          shell("running", { turn: { state: "running", at: null } }),
          shell("reopened", { settledAt: at(10), settledOverride: "active" }),
        ],
        { startOfDayMs: START },
      ),
    ).toEqual([]);
  });

  it("names a merged pull request, and keys rows across environments", () => {
    const link = (number: number, state: "open" | "merged", mergedAt: string | null) => ({
      host: "github.com",
      repository: "e6/e6code",
      number,
      url: `https://github.com/e6/e6code/pull/${number}`,
      source: "created" as const,
      linkedAt: at(8),
      stack: null,
      snapshot: {
        state,
        title: "Sidebar drag reorder",
        headBranch: "drag",
        baseBranch: "main",
        isDraft: false,
        updatedAt: null,
        syncedAt: at(11),
        mergedAt,
      },
    });
    const rows = selectDoneToday(
      [
        shell("same", {
          settledAt: at(11, 5),
          pullRequests: [link(411, "open", null), link(412, "merged", at(11, 5))],
        }),
        shell("same", { environmentId: REMOTE, settledAt: at(10) }),
      ],
      { startOfDayMs: START },
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
    expect(rows[0]?.mergedPullRequest).toEqual({ number: 412, mergedAt: at(11, 5) });
    expect(rows[1]?.mergedPullRequest).toBeNull();
  });

  it("names only a pull request merged today", () => {
    const merged = (number: number, mergedAt: string | null) => ({
      host: "github.com",
      repository: "e6/e6code",
      number,
      url: `https://github.com/e6/e6code/pull/${number}`,
      source: "created" as const,
      linkedAt: at(8, 0, 10),
      stack: null,
      snapshot: {
        state: "merged" as const,
        title: "Old work",
        headBranch: "old",
        baseBranch: "main",
        isDraft: false,
        updatedAt: null,
        syncedAt: at(9),
        mergedAt,
      },
    });
    const [row] = selectDoneToday(
      [
        shell("old-merge", {
          settledAt: at(14, 20),
          pullRequests: [merged(300, at(16, 0, 10)), merged(301, null)],
        }),
      ],
      { startOfDayMs: START },
    );
    expect(row?.how).toBe("settled");
    expect(row?.mergedPullRequest).toBeNull();
  });
});
