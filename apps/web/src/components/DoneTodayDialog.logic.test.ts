import { describe, expect, it } from "vite-plus/test";

import { doneTodayMeta, wrapUpSnoozePlan } from "./DoneTodayDialog.logic";

const formatTime = (iso: string) => iso.slice(11, 16);

describe("doneTodayMeta", () => {
  it("names the project, the line totals and when it was settled", () => {
    expect(
      doneTodayMeta(
        {
          doneAt: "2026-11-11T14:20:00.000Z",
          how: "settled",
          diffStat: { insertions: 66, deletions: 13 },
          mergedPullRequest: null,
        },
        { projectName: "e6code", formatTime },
      ),
    ).toBe("e6code · +66 −13 · settled 14:20");
  });

  it("names a merged pull request in place of the settle time", () => {
    expect(
      doneTodayMeta(
        {
          doneAt: "2026-11-11T14:20:00.000Z",
          how: "settled",
          diffStat: { insertions: 120, deletions: 48 },
          mergedPullRequest: { number: 412, mergedAt: "2026-11-11T11:05:00.000Z" },
        },
        { projectName: "e6code", formatTime },
      ),
    ).toBe("e6code · +120 −48 · PR #412 merged 11:05");
  });

  it("leaves out what it does not know", () => {
    expect(
      doneTodayMeta(
        {
          doneAt: "2026-11-11T09:40:00.000Z",
          how: "finished",
          diffStat: { insertions: 0, deletions: 0 },
          mergedPullRequest: null,
        },
        { projectName: null, formatTime },
      ),
    ).toBe("finished 09:40");
  });
});

describe("wrapUpSnoozePlan", () => {
  const row = (title: string, kind: "working" | "failed" | "waiting" | "starting") => ({
    title,
    snoozable: kind === "working" || kind === "failed",
    waitingOnYou: kind === "waiting",
  });
  const plan = (rows: ReturnType<typeof row>[], whenLabel = "09:00") =>
    wrapUpSnoozePlan({ rows, whenLabel });

  it("says it, both or the number when every listed thread can be snoozed", () => {
    expect(plan([row("Usage page totals", "working")])).toEqual({
      label: "Snooze it until tomorrow 09:00",
      note: null,
    });
    expect(plan([row("a", "working"), row("b", "failed")]).label).toBe(
      "Snooze both until tomorrow 09:00",
    );
    expect(
      plan([row("a", "working"), row("b", "working"), row("c", "working")], "9:00 AM").label,
    ).toBe("Snooze 3 until tomorrow 9:00 AM");
  });

  it("names what it snoozes and says why approvals and questions stay", () => {
    expect(
      plan([row("Fix tunnel reconnect loop", "waiting"), row("Usage page totals", "working")]),
    ).toEqual({
      label: "Snooze Usage page totals until tomorrow 09:00",
      note: "Approvals and questions cannot be snoozed, so they stay open.",
    });
    expect(plan([row("a", "waiting"), row("b", "working"), row("c", "failed")]).label).toBe(
      "Snooze the other 2 until tomorrow 09:00",
    );
  });

  it("offers no button when nothing listed can be snoozed", () => {
    expect(plan([row("a", "waiting"), row("b", "waiting")])).toEqual({
      label: null,
      note: "Approvals and questions cannot be snoozed, so they stay open.",
    });
  });

  it("names the threads kept for another reason", () => {
    expect(plan([row("a", "starting"), row("b", "waiting"), row("c", "working")]).note).toBe(
      "a and b cannot be snoozed right now.",
    );
  });
});
