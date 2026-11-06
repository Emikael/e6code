import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";

import { selectPickUpThreads } from "./DraftHeroFooter.logic";

function shell(
  id: string,
  overrides: Partial<
    Pick<
      EnvironmentThreadShell,
      "hasPendingApprovals" | "hasPendingUserInput" | "archivedAt" | "snoozedUntil" | "updatedAt"
    >
  >,
): EnvironmentThreadShell {
  return {
    id,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    archivedAt: null,
    snoozedUntil: null,
    updatedAt: "2026-11-01T10:00:00.000Z",
    ...overrides,
  } as unknown as EnvironmentThreadShell;
}

const nowMs = Date.parse("2026-11-01T12:00:00.000Z");

describe("selectPickUpThreads", () => {
  it("lists approvals before questions, newest first, and skips threads not waiting on you", () => {
    const picked = selectPickUpThreads(
      [
        shell("idle", {}),
        shell("old-question", { hasPendingUserInput: true, updatedAt: "2026-11-01T09:00:00.000Z" }),
        shell("new-question", { hasPendingUserInput: true, updatedAt: "2026-11-01T11:00:00.000Z" }),
        shell("approval", { hasPendingApprovals: true, updatedAt: "2026-11-01T08:00:00.000Z" }),
      ],
      { limit: 3, nowMs },
    );
    expect(picked.map((entry) => [String(entry.thread.id), entry.reason])).toEqual([
      ["approval", "approval"],
      ["new-question", "input"],
      ["old-question", "input"],
    ]);
  });

  it("leaves out archived threads and threads snoozed into the future", () => {
    const picked = selectPickUpThreads(
      [
        shell("archived", { hasPendingApprovals: true, archivedAt: "2026-11-01T11:30:00.000Z" }),
        shell("snoozed", { hasPendingApprovals: true, snoozedUntil: "2026-11-02T09:00:00.000Z" }),
        shell("woke-up", { hasPendingApprovals: true, snoozedUntil: "2026-11-01T11:00:00.000Z" }),
      ],
      { limit: 3, nowMs },
    );
    expect(picked.map((entry) => String(entry.thread.id))).toEqual(["woke-up"]);
  });

  it("caps the list", () => {
    const threads = Array.from({ length: 5 }, (_, index) =>
      shell(`t${index}`, { hasPendingUserInput: true }),
    );
    expect(selectPickUpThreads(threads, { limit: 3, nowMs })).toHaveLength(3);
  });
});
