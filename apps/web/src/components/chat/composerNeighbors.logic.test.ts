import { describe, expect, it } from "vite-plus/test";

import {
  nowBarOffersReviewDiff,
  rightPanelHoldsFill,
  screenFillHolder,
  selectComposerSlotCard,
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

describe("selectComposerSlotCard", () => {
  it("shows one card, by precedence: permission prompt, recap, Next card", () => {
    expect(selectComposerSlotCard({ permissionPrompt: true, recap: true, nextCard: true })).toBe(
      "permission",
    );
    expect(selectComposerSlotCard({ permissionPrompt: false, recap: true, nextCard: true })).toBe(
      "recap",
    );
    // A dismissed recap no longer applies, so the Next card shows.
    expect(selectComposerSlotCard({ permissionPrompt: false, recap: false, nextCard: true })).toBe(
      "next",
    );
    expect(
      selectComposerSlotCard({ permissionPrompt: false, recap: false, nextCard: false }),
    ).toBeNull();
  });
});

describe("nowBarOffersReviewDiff", () => {
  it("keeps Review diff reachable whichever card holds the slot", () => {
    const slotFor = (permissionPrompt: boolean, recap: boolean) =>
      selectComposerSlotCard({ permissionPrompt, recap, nextCard: true });
    // The Next card shows: it offers Review diff, so the bar does not repeat it.
    expect(nowBarOffersReviewDiff(slotFor(false, false))).toBe(false);
    // The recap or the permission prompt took the slot: the bar is the only place left.
    expect(nowBarOffersReviewDiff(slotFor(false, true))).toBe(true);
    expect(nowBarOffersReviewDiff(slotFor(true, false))).toBe(true);
    expect(nowBarOffersReviewDiff(slotFor(true, true))).toBe(true);
    expect(nowBarOffersReviewDiff(null)).toBe(true);
  });
});
