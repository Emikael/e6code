import { describe, expect, it } from "vite-plus/test";

import { modelMetaParts } from "./modelMeta.ts";

describe("modelMetaParts", () => {
  it("formats context windows in K below a million and M from there", () => {
    expect(
      [128_000, 200_000, 922_000, 999_600, 1_000_000, 1_048_576, 2_000_000].map(
        (contextWindowTokens) => modelMetaParts({ contextWindowTokens }).context,
      ),
    ).toEqual([
      "128K context",
      "200K context",
      "922K context",
      "1M context",
      "1M context",
      "1M context",
      "2M context",
    ]);
  });

  it("spells the price tier out for assistive technology", () => {
    expect(
      [1, 2, 3].map((priceTier) => modelMetaParts({ priceTier: priceTier as 1 | 2 | 3 })),
    ).toEqual([
      { price: "$", priceAccessibilityLabel: "Price tier: low" },
      { price: "$$", priceAccessibilityLabel: "Price tier: medium" },
      { price: "$$$", priceAccessibilityLabel: "Price tier: high" },
    ]);
  });

  it("leaves out whatever the model does not report", () => {
    expect(modelMetaParts({})).toEqual({});
    expect(modelMetaParts({ contextWindowTokens: 1_000_000 })).toEqual({ context: "1M context" });
  });
});
