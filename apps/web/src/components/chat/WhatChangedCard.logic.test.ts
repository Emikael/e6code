import { describe, expect, it } from "vite-plus/test";

import { offersNewLook, shouldShowWhatChanged } from "./WhatChangedCard.logic";

describe("shouldShowWhatChanged", () => {
  it("shows once to a profile with threads from before the redesign", () => {
    const threads = [{ createdAt: "2026-10-01T09:00:00.000Z" }];
    expect(shouldShowWhatChanged({ dismissed: false, threads })).toBe(true);
    expect(shouldShowWhatChanged({ dismissed: true, threads })).toBe(false);
  });

  it("stays away from a fresh profile, even after its first threads", () => {
    expect(shouldShowWhatChanged({ dismissed: false, threads: [] })).toBe(false);
    expect(
      shouldShowWhatChanged({
        dismissed: false,
        threads: [{ createdAt: "2026-12-01T09:00:00.000Z" }],
      }),
    ).toBe(false);
  });
});

describe("offersNewLook", () => {
  it("offers Graphite at 120 only to a profile without it", () => {
    expect(offersNewLook({ stockAccent: "iris", appearanceContrast: 100 })).toBe(true);
    expect(offersNewLook({ stockAccent: "graphite", appearanceContrast: 100 })).toBe(true);
    expect(offersNewLook({ stockAccent: "graphite", appearanceContrast: 120 })).toBe(false);
  });
});
