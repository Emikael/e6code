import { ProviderDriverKind } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  formatUsageReset,
  selectSidebarUsageMeters,
  usageMeterAccessibleName,
  type SidebarUsageProvider,
} from "./SidebarFooter.logic";

function provider(overrides: Partial<SidebarUsageProvider> = {}): SidebarUsageProvider {
  return {
    instanceId: "codex",
    driver: ProviderDriverKind.make("codex"),
    displayName: "Codex",
    enabled: true,
    usageLimits: {
      windows: [
        {
          id: "week",
          kind: "weekly",
          label: "Weekly",
          usedPercent: 86,
          resetsAt: "2026-10-22T09:00:00.000Z",
        },
        { id: "session", kind: "session", label: "5-hour", usedPercent: 10 },
      ],
    },
    ...overrides,
  };
}

describe("selectSidebarUsageMeters", () => {
  it("keeps one meter per usage source and prefers the weekly window", () => {
    const meters = selectSidebarUsageMeters([
      provider(),
      provider({
        instanceId: "claude",
        driver: ProviderDriverKind.make("claudeAgent"),
        displayName: "Claude",
        usageLimits: { windows: [] },
      }),
      provider({ instanceId: "disabled", enabled: false }),
      provider({ instanceId: "plain", usageLimits: undefined }),
    ]);

    expect(meters.map((meter) => meter.key)).toEqual(["codex", "claude"]);
    expect(meters[0]).toMatchObject({
      label: "Codex",
      windowLabel: "Weekly",
      percent: 86,
      resetsAt: "2026-10-22T09:00:00.000Z",
    });
    expect(meters[1]).toMatchObject({ percent: null, windowLabel: "usage" });
    expect(
      usageMeterAccessibleName(meters[0]!, formatUsageReset(meters[0]!.resetsAt!, "UTC")),
    ).toBe("Codex Weekly 86% used, resets Thu 09:00");
    expect(usageMeterAccessibleName(meters[1]!, null)).toBe("Claude usage: no usage source");
  });
});
