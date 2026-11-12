import { describe, expect, it } from "vite-plus/test";

import { composerControlsSummary, nonDefaultTraitLabels } from "./composerControlsSummary";

const text = (parts: ReturnType<typeof composerControlsSummary>) =>
  parts.map((part) => part.text).join(" · ");

describe("composerControlsSummary", () => {
  it("spells out effort, permissions and mode", () => {
    expect(
      text(
        composerControlsSummary({
          effort: { selected: "balanced", currentLabel: "Medium" },
          runtimeMode: "approval-required",
          interactionMode: "default",
        }),
      ),
    ).toBe("Balanced · Supervised · Build");
  });

  it("names a level outside the quick steps, and Plan", () => {
    expect(
      text(
        composerControlsSummary({
          effort: { selected: null, currentLabel: "Max" },
          runtimeMode: "auto",
          interactionMode: "plan",
        }),
      ),
    ).toBe("Max · Auto · Plan");
  });

  it("leaves out effort and mode when the model or settings offer none", () => {
    expect(
      text(composerControlsSummary({ effort: null, runtimeMode: "auto", interactionMode: null })),
    ).toBe("Auto");
  });

  it("marks Full access as risky so it is never hidden", () => {
    const parts = composerControlsSummary({
      effort: null,
      runtimeMode: "full-access",
      interactionMode: "default",
    });
    expect(parts.filter((part) => part.risky).map((part) => part.text)).toEqual(["Full access"]);
  });
});

describe("nonDefaultTraitLabels", () => {
  const effort = {
    id: "effort",
    label: "Effort",
    type: "select" as const,
    options: [
      { id: "medium", label: "Medium", isDefault: true },
      { id: "high", label: "High" },
    ],
  };
  const contextWindow = {
    id: "contextWindow",
    label: "Context window",
    type: "select" as const,
    options: [
      { id: "200k", label: "200K", isDefault: true },
      { id: "1m", label: "1M" },
    ],
  };
  const fastMode = { id: "fastMode", label: "Fast mode", type: "boolean" as const };
  const thinking = { id: "thinking", label: "Thinking", type: "boolean" as const };
  const defaults = [effort, contextWindow, fastMode, { ...thinking, currentValue: true }];

  it("names only what differs from the default, leaving effort to its own part", () => {
    expect(
      nonDefaultTraitLabels({
        descriptors: [
          { ...effort, currentValue: "high" },
          { ...contextWindow, currentValue: "1m" },
          { ...fastMode, currentValue: true },
          { ...thinking, currentValue: false },
        ],
        defaults,
        effortDescriptorId: "effort",
        ultrathink: false,
      }),
    ).toEqual(["1M", "Fast", "Thinking Off"]);
  });

  it("says nothing at the defaults, and names Ultrathink", () => {
    expect(
      nonDefaultTraitLabels({
        descriptors: [
          effort,
          { ...contextWindow, currentValue: "200k" },
          { ...fastMode, currentValue: false },
          { ...thinking, currentValue: true },
        ],
        defaults,
        effortDescriptorId: "effort",
        ultrathink: false,
      }),
    ).toEqual([]);
    expect(
      nonDefaultTraitLabels({
        descriptors: [effort],
        defaults,
        effortDescriptorId: "effort",
        ultrathink: true,
      }),
    ).toEqual(["Ultrathink"]);
  });

  it("joins the chip between effort and permissions", () => {
    expect(
      text(
        composerControlsSummary({
          effort: { selected: "balanced", currentLabel: "Medium" },
          traits: ["Fast", "1M"],
          runtimeMode: "approval-required",
          interactionMode: "default",
        }),
      ),
    ).toBe("Balanced · Fast · 1M · Supervised · Build");
  });
});
