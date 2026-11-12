import { describe, expect, it } from "vite-plus/test";

import { doneTodayMeta, wrapUpSnoozeLabel } from "./DoneTodayDialog.logic";

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

describe("wrapUpSnoozeLabel", () => {
  it("says it, both or the number", () => {
    expect(wrapUpSnoozeLabel(1, "09:00")).toBe("Snooze it until tomorrow 09:00");
    expect(wrapUpSnoozeLabel(2, "09:00")).toBe("Snooze both until tomorrow 09:00");
    expect(wrapUpSnoozeLabel(3, "9:00 AM")).toBe("Snooze 3 until tomorrow 9:00 AM");
  });
});
