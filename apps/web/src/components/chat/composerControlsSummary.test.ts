import { describe, expect, it } from "vite-plus/test";

import { composerControlsSummary } from "./composerControlsSummary";

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
