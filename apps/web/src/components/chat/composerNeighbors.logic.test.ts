import { describe, expect, it } from "vite-plus/test";

import {
  reviewDiffPlacement,
  rightPanelHoldsFill,
  screenFillHolder,
} from "./composerNeighbors.logic";

describe("screenFillHolder", () => {
  it("gives the fill to Send while the composer has a draft, whatever else shows", () => {
    expect(screenFillHolder({ composerHasText: true, panelHoldsFill: true })).toBe("send");
    expect(screenFillHolder({ composerHasText: true, panelHoldsFill: false })).toBe("send");
  });

  it("lets an open Diff or pull request panel keep its own fill over the card", () => {
    expect(screenFillHolder({ composerHasText: false, panelHoldsFill: true })).toBe("panel");
    expect(screenFillHolder({ composerHasText: false, panelHoldsFill: false })).toBe("card");
  });
});

describe("rightPanelHoldsFill", () => {
  it("counts only an open Diff or pull request surface", () => {
    expect(rightPanelHoldsFill({ open: true, surfaceKind: "diff" })).toBe(true);
    expect(rightPanelHoldsFill({ open: true, surfaceKind: "pull-request" })).toBe(true);
    expect(rightPanelHoldsFill({ open: false, surfaceKind: "diff" })).toBe(false);
    expect(rightPanelHoldsFill({ open: true, surfaceKind: "terminal" })).toBe(false);
    expect(rightPanelHoldsFill({ open: true, surfaceKind: null })).toBe(false);
  });
});

describe("reviewDiffPlacement", () => {
  it("offers Review diff in exactly one place for a finished turn with changes", () => {
    // The Next card ends the timeline: the now bar does not repeat it.
    expect(reviewDiffPlacement({ nextCard: true, timelineReady: true })).toBe("next-card");
    // The timeline has not rendered its end yet: the now bar keeps it reachable.
    expect(reviewDiffPlacement({ nextCard: true, timelineReady: false })).toBe("now-bar");
    // No Next card (settled, or no changes): the now bar decides on its own.
    expect(reviewDiffPlacement({ nextCard: false, timelineReady: true })).toBe("now-bar");
  });
});
