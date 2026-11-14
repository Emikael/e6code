/**
 * Two rules for what sits around the composer, so features that meet there
 * do not stack or compete.
 *
 * One fill per screen: at most one filled (primary) button shows at a time,
 * and the fill follows the keyboard. While the composer holds a draft, Send
 * has it. Otherwise a right-panel surface with its own footer primary (the
 * Diff panel's, a pull request's Merge) has it while it shows. Otherwise the
 * card's primary (the Next card's Review diff, the start screen's Approve)
 * does. Every other primary renders as outline.
 *
 * One slot above the composer: the notification permission prompt and the
 * recap would stack there, so the recap waits while the prompt shows. The
 * Next card is not in that slot: it ends the finished turn in the timeline
 * (boards 2 and 3).
 */

export type ScreenFillHolder = "send" | "panel" | "card";

/** Right-panel surfaces whose footer carries a filled button of their own. */
const FILL_HOLDING_PANEL_SURFACES: ReadonlySet<string> = new Set(["diff", "pull-request"]);

/** Whether the right panel is showing a surface that holds its own fill. */
export function rightPanelHoldsFill(panel: {
  readonly open: boolean;
  readonly surfaceKind: string | null;
}): boolean {
  return (
    panel.open && panel.surfaceKind !== null && FILL_HOLDING_PANEL_SURFACES.has(panel.surfaceKind)
  );
}

/** Who holds the screen's one fill. */
export function screenFillHolder(input: {
  /** The composer holds a draft of its own. */
  readonly composerHasText: boolean;
  /** See `rightPanelHoldsFill`; false where no right panel can show. */
  readonly panelHoldsFill: boolean;
}): ScreenFillHolder {
  if (input.composerHasText) return "send";
  if (input.panelHoldsFill) return "panel";
  return "card";
}

/**
 * Where a finished turn with changes offers Review diff. The Next card at the
 * end of the timeline offers it once the timeline renders its frontier; until
 * then (thread detail still loading) the now bar does, so it is never missing.
 */
export function reviewDiffPlacement(input: {
  readonly nextCard: boolean;
  readonly timelineReady: boolean;
}): "next-card" | "now-bar" {
  return input.nextCard && input.timelineReady ? "next-card" : "now-bar";
}
