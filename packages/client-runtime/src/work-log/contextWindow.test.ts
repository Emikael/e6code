import { describe, expect, it } from "vite-plus/test";
import { EventId, type OrchestrationThreadActivity, TurnId } from "@e6tools/contracts";

import {
  type ContextWindowSnapshot,
  deriveLatestContextWindowSnapshot,
  describeContextWindowUsage,
  formatContextWindowTokens,
} from "./contextWindow.ts";

function snapshotFrom(payload: Record<string, unknown>): ContextWindowSnapshot {
  const snapshot = deriveLatestContextWindowSnapshot([
    makeActivity("activity-1", "context-window.updated", payload),
  ]);
  if (snapshot === null) throw new Error("expected a snapshot");
  return snapshot;
}

describe("describeContextWindowUsage", () => {
  it("states share, used and window", () => {
    expect(
      describeContextWindowUsage(snapshotFrom({ usedTokens: 136_000, maxTokens: 200_000 })),
    ).toEqual({
      label: "68% used · 136K of 200K tokens",
      percent: 68,
      warning: false,
      compactionNote: null,
      accessibilityLabel: "Context window 68% used · 136K of 200K tokens",
    });
  });

  it("states only the used tokens when the window is unknown", () => {
    const summary = describeContextWindowUsage(snapshotFrom({ usedTokens: 136_000 }));
    expect(summary.label).toBe("136K tokens used");
    expect(summary.percent).toBeNull();
    expect(summary.warning).toBe(false);
  });

  it("warns from 85% used", () => {
    expect(
      describeContextWindowUsage(snapshotFrom({ usedTokens: 169_000, maxTokens: 200_000 })).warning,
    ).toBe(false);
    const summary = describeContextWindowUsage(
      snapshotFrom({ usedTokens: 170_000, maxTokens: 200_000 }),
    );
    expect(summary.warning).toBe(true);
    expect(summary.label).toBe("85% used · 170K of 200K tokens");
  });

  it("caps an overfull window at 100%", () => {
    const summary = describeContextWindowUsage(
      snapshotFrom({ usedTokens: 210_000, maxTokens: 200_000 }),
    );
    expect(summary.label).toBe("100% used · 210K of 200K tokens");
    expect(summary.percent).toBe(100);
  });

  it("shows a sliver of usage as under 1%", () => {
    expect(
      describeContextWindowUsage(snapshotFrom({ usedTokens: 900, maxTokens: 200_000 })).label,
    ).toBe("<1% used · 900 of 200K tokens");
  });

  it("notes automatic compaction as a share of the window", () => {
    const summary = describeContextWindowUsage(
      snapshotFrom({
        usedTokens: 136_000,
        maxTokens: 200_000,
        compactsAutomatically: true,
        autoCompactThreshold: 180_000,
      }),
    );
    expect(summary.compactionNote).toBe("Compacts automatically near 90%");
    expect(summary.accessibilityLabel).toBe(
      "Context window 68% used · 136K of 200K tokens. Compacts automatically near 90%",
    );
  });

  it("notes automatic compaction in tokens when the window is unknown", () => {
    expect(
      describeContextWindowUsage(
        snapshotFrom({
          usedTokens: 50_000,
          compactsAutomatically: true,
          autoCompactThreshold: 180_000,
        }),
      ).compactionNote,
    ).toBe("Compacts automatically at 180K tokens");
  });

  it("omits the note without a threshold or automatic compaction", () => {
    expect(
      describeContextWindowUsage(
        snapshotFrom({ usedTokens: 1, maxTokens: 10, compactsAutomatically: true }),
      ).compactionNote,
    ).toBeNull();
    expect(
      describeContextWindowUsage(
        snapshotFrom({ usedTokens: 1, maxTokens: 10, autoCompactThreshold: 9 }),
      ).compactionNote,
    ).toBeNull();
  });
});

function makeActivity(id: string, kind: string, payload: unknown): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.make("turn-1"),
    createdAt: "2026-03-23T00:00:00.000Z",
  };
}

describe("contextWindow", () => {
  it("derives the latest valid context window snapshot", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 1000,
      }),
      makeActivity("activity-2", "tool.started", {}),
      makeActivity("activity-3", "context-window.updated", {
        usedTokens: 14_000,
        maxTokens: 258_000,
        compactsAutomatically: true,
        autoCompactThreshold: 200_000,
      }),
    ]);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedTokens).toBe(14_000);
    expect(snapshot?.totalProcessedTokens).toBeNull();
    expect(snapshot?.maxTokens).toBe(258_000);
    expect(snapshot?.compactsAutomatically).toBe(true);
    expect(snapshot?.autoCompactThreshold).toBe(200_000);
  });

  it("ignores malformed payloads", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {}),
    ]);

    expect(snapshot).toBeNull();
  });

  it("keeps valid zero-usage snapshots", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 0,
        maxTokens: 100_000,
      }),
    ]);

    expect(snapshot).toMatchObject({
      usedTokens: 0,
      maxTokens: 100_000,
      remainingTokens: 100_000,
      usedPercentage: 0,
      remainingPercentage: 100,
    });
  });

  it("formats compact token counts", () => {
    expect(formatContextWindowTokens(999)).toBe("999");
    expect(formatContextWindowTokens(1400)).toBe("1.4K");
    expect(formatContextWindowTokens(14_000)).toBe("14K");
    expect(formatContextWindowTokens(258_000)).toBe("258K");
  });

  it("includes total processed tokens when available", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 81_659,
        totalProcessedTokens: 748_126,
        maxTokens: 258_400,
        lastUsedTokens: 81_659,
      }),
    ]);

    expect(snapshot?.usedTokens).toBe(81_659);
    expect(snapshot?.totalProcessedTokens).toBe(748_126);
  });
});
