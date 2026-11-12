import { describe, expect, it } from "vite-plus/test";

import { panelFillHolder, type PanelFillState, type PanelFillView } from "./panelFill";

const pullRequest = (
  tab: "summary" | "timeline" | "code",
  next: { nextStepHasAction?: boolean; mergeReady?: boolean } = {},
): PanelFillView => ({
  kind: "pull-request",
  tab,
  nextStepHasAction: next.nextStepHasAction ?? false,
  mergeReady: next.mergeReady ?? false,
});

const state = (view: PanelFillView, overrides: Partial<PanelFillState> = {}): PanelFillState => ({
  view,
  composerHasText: false,
  commentDraftOpen: false,
  reviewStepPending: false,
  ...overrides,
});

describe("panelFillHolder", () => {
  it("gives the fill to Send whenever the composer has text", () => {
    for (const view of [
      { kind: "diff" } as const,
      { kind: "surface" } as const,
      pullRequest("summary", { nextStepHasAction: true }),
      pullRequest("summary", { mergeReady: true }),
      pullRequest("timeline", { mergeReady: true }),
      pullRequest("code", { mergeReady: true }),
    ]) {
      expect(
        panelFillHolder(
          state(view, { composerHasText: true, reviewStepPending: true, commentDraftOpen: true }),
        ),
      ).toBe("send");
    }
  });

  it("fills nothing while a comment draft is open", () => {
    expect(
      panelFillHolder(state({ kind: "diff" }, { commentDraftOpen: true, reviewStepPending: true })),
    ).toBeNull();
    expect(
      panelFillHolder(
        state(pullRequest("code", { mergeReady: true }), {
          commentDraftOpen: true,
          reviewStepPending: true,
        }),
      ),
    ).toBeNull();
  });

  it("gives the Diff's fill to the review footer's step, never the rail's commit", () => {
    expect(panelFillHolder(state({ kind: "diff" }, { reviewStepPending: true }))).toBe(
      "review-step",
    );
    expect(panelFillHolder(state({ kind: "diff" }))).toBeNull();
  });

  it("keeps the merge outline on the Code tab while the review has a step", () => {
    expect(
      panelFillHolder(
        state(pullRequest("code", { mergeReady: true }), { reviewStepPending: true }),
      ),
    ).toBe("review-step");
    expect(panelFillHolder(state(pullRequest("code", { mergeReady: true })))).toBe("merge");
    expect(panelFillHolder(state(pullRequest("code")))).toBeNull();
  });

  it("gives Summary's fill to the next step, or the merge once ready", () => {
    expect(panelFillHolder(state(pullRequest("summary", { nextStepHasAction: true })))).toBe(
      "next-step",
    );
    expect(panelFillHolder(state(pullRequest("summary", { mergeReady: true })))).toBe("merge");
    expect(panelFillHolder(state(pullRequest("summary")))).toBeNull();
  });

  it("gives Timeline's fill to the merge only once ready", () => {
    expect(panelFillHolder(state(pullRequest("timeline", { mergeReady: true })))).toBe("merge");
    expect(panelFillHolder(state(pullRequest("timeline", { nextStepHasAction: true })))).toBeNull();
  });

  it("lets another surface fill its own single action", () => {
    expect(panelFillHolder(state({ kind: "surface" }))).toBe("surface-action");
  });
});
