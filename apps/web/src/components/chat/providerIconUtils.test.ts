import { describe, expect, it } from "vite-plus/test";

import { formatModelChipLabel } from "./providerIconUtils";

describe("formatModelChipLabel", () => {
  it("names the effort step beside the model", () => {
    expect(
      formatModelChipLabel("Claude Opus", { selected: "balanced", currentLabel: "Medium" }),
    ).toBe("Claude Opus · balanced");
  });

  it("falls back to the model's own level between or beyond the steps", () => {
    expect(formatModelChipLabel("GPT-5", { selected: null, currentLabel: "Extra High" })).toBe(
      "GPT-5 · extra high",
    );
  });

  it("shows the model alone when it has no effort", () => {
    expect(formatModelChipLabel("Composer", null)).toBe("Composer");
    expect(formatModelChipLabel("Composer", { selected: null, currentLabel: null })).toBe(
      "Composer",
    );
  });
});
