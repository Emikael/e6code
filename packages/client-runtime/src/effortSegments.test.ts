import type { ProviderOptionDescriptor } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  effortSegmentName,
  effortSegmentForValue,
  nextEffortSegment,
  resolveEffortSegments,
} from "./effortSegments.ts";

type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;

function select(
  id: string,
  levels: string,
  extra: Partial<Pick<SelectDescriptor, "promptInjectedValues">> = {},
): SelectDescriptor {
  // "high*" marks the model default.
  return {
    id,
    label: id,
    type: "select",
    options: levels.split(",").map((level) => {
      const isDefault = level.endsWith("*");
      const optionId = level.replace("*", "");
      return { id: optionId, label: optionId, ...(isDefault ? { isDefault: true } : {}) };
    }),
    ...extra,
  };
}

const claude = (levels: string) =>
  select("effort", levels, { promptInjectedValues: ["ultrathink"] });

describe("resolveEffortSegments", () => {
  it.each([
    // Claude: Max, Ultracode and Ultrathink stay in the traits menu.
    [
      "Claude Fable 5",
      claude("low,medium*,high,xhigh,max,ultracode,ultrathink"),
      ["low", "medium", "xhigh"],
    ],
    [
      "Claude Opus 5",
      claude("low,medium,high*,xhigh,max,ultracode,ultrathink"),
      ["low", "high", "xhigh"],
    ],
    [
      "Claude Opus 4.7 (default at the top)",
      claude("low,medium,high,xhigh*,max,ultrathink"),
      ["low", "medium", "xhigh"],
    ],
    ["Claude Opus 4.6", claude("low,medium,high*,max,ultrathink"), ["low", "medium", "high"]],
    ["Claude Opus 4.5", claude("low,medium,high*,max"), ["low", "medium", "high"]],
    // Codex: reasoning levels come from the CLI per model.
    ["Codex", select("reasoningEffort", "low,medium*,high,xhigh"), ["low", "medium", "xhigh"]],
    [
      "Codex with none and minimal",
      select("reasoningEffort", "none,minimal,low,medium*,high"),
      ["minimal", "medium", "high"],
    ],
    // OpenCode, Cursor and Grok expose their own ids.
    ["OpenCode", select("variant", "low,medium*,high,xhigh"), ["low", "medium", "xhigh"]],
    ["Cursor", select("reasoning", "low,medium,high*,xhigh"), ["low", "high", "xhigh"]],
    [
      "Grok without a default",
      select("reasoningEffort", "low,high,xhigh"),
      ["low", "high", "xhigh"],
    ],
    ["Unknown levels without medium", select("reasoningEffort", "a,b,c,d"), ["a", "b", "d"]],
  ])("maps %s", (_name, descriptor, [fast, balanced, deep]) => {
    expect(resolveEffortSegments(descriptor)?.values).toEqual({ fast, balanced, deep });
  });

  it.each([
    ["no descriptor", null],
    ["a select that is not effort", select("contextWindow", "200k,1m*,2m")],
    ["two levels", select("reasoningEffort", "low,high*")],
    ["two ordinary levels plus ceilings", claude("high*,xhigh,max,ultracode,ultrathink")],
    ["off plus two levels", select("thinking_level", "off,low*,high")],
  ])("hides the control for %s", (_name, descriptor) => {
    expect(resolveEffortSegments(descriptor)).toBeNull();
  });
});

describe("effort segment state", () => {
  const segments = resolveEffortSegments(
    claude("low,medium,high*,xhigh,max,ultracode,ultrathink"),
  )!;

  it("names each step as effort with the model's real level", () => {
    const labelled = resolveEffortSegments({
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium", isDefault: true },
        { id: "xhigh", label: "Extra High" },
      ],
    })!;
    expect(effortSegmentName(labelled, "fast")).toBe("Effort: Fast · Low");
    expect(effortSegmentName(labelled, "balanced")).toBe("Effort: Balanced · Medium");
    expect(effortSegmentName(labelled, "deep")).toBe("Effort: Deep · Extra High");
  });

  it("selects the segment for a mapped level and none for others", () => {
    expect(effortSegmentForValue(segments, "high")).toBe("balanced");
    expect(effortSegmentForValue(segments, "medium")).toBeNull();
    expect(effortSegmentForValue(segments, "max")).toBeNull();
  });

  it.each([
    ["low", "balanced"],
    ["high", "deep"],
    ["xhigh", "fast"],
    // Between Fast and Balanced moves up to Balanced.
    ["medium", "balanced"],
    // Levels outside the quick steps wrap to Fast.
    ["max", "fast"],
    ["ultrathink", "fast"],
    [null, "fast"],
  ] as const)("cycles from %s to %s", (value, next) => {
    expect(nextEffortSegment(segments, value)).toBe(next);
  });
});
