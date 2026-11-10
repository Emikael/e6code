import type { ProviderOptionDescriptor } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveEffortSteps, selectableChoices } from "./thread-settings-options";

const effortDescriptor: Extract<ProviderOptionDescriptor, { type: "select" }> = {
  id: "effort",
  label: "Reasoning",
  type: "select",
  options: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium", isDefault: true },
    { id: "high", label: "High" },
    { id: "ultrathink", label: "Ultrathink" },
    { id: "ultracode", label: "Ultracode" },
  ],
  currentValue: "high",
  promptInjectedValues: ["ultrathink"],
};

describe("selectableChoices", () => {
  it("hides prompt-injected and workflow-trigger choices, keeping declared order", () => {
    expect(selectableChoices(effortDescriptor).map((choice) => choice.id)).toEqual([
      "low",
      "medium",
      "high",
    ]);
  });
});

describe("resolveEffortSteps", () => {
  it("maps the effort descriptor and marks the current level's step", () => {
    const steps = resolveEffortSteps([effortDescriptor]);
    expect(steps?.descriptorId).toBe("effort");
    expect(steps?.segments.values).toEqual({ fast: "low", balanced: "medium", deep: "high" });
    expect(steps?.selected).toBe("deep");
  });

  it("falls back to the default level and checks no step between steps", () => {
    const { currentValue: _current, ...unset } = effortDescriptor;
    expect(resolveEffortSteps([unset])?.selected).toBe("balanced");
    const fourLevels = {
      ...effortDescriptor,
      options: [...effortDescriptor.options, { id: "xhigh", label: "Extra High" }],
    };
    expect(resolveEffortSteps([fourLevels])?.selected).toBeNull();
  });

  it("hides when the first select is not effort or effort has too few levels", () => {
    const contextWindow = { ...effortDescriptor, id: "contextWindow" };
    expect(resolveEffortSteps([contextWindow, effortDescriptor])).toBeNull();
    const twoLevels = { ...effortDescriptor, options: effortDescriptor.options.slice(1, 3) };
    expect(resolveEffortSteps([twoLevels])).toBeNull();
    expect(resolveEffortSteps([])).toBeNull();
  });
});
