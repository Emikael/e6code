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
 * One slot above the composer: the notification permission prompt, the
 * recap and the Next card would stack there, putting the fill farthest from
 * the composer. Only the first that applies shows; when the recap is
 * dismissed the Next card may show.
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

export type ComposerSlotCard = "permission" | "recap" | "next";

/** The one card above the composer, by precedence: permission prompt, recap, Next card. */
export function selectComposerSlotCard(input: {
  readonly permissionPrompt: boolean;
  readonly recap: boolean;
  readonly nextCard: boolean;
}): ComposerSlotCard | null {
  if (input.permissionPrompt) return "permission";
  if (input.recap) return "recap";
  if (input.nextCard) return "next";
  return null;
}

/**
 * The now bar's Review diff steps aside only for a Next card that is on
 * screen. A Next card that applies but lost the slot to the permission prompt
 * or the recap offers nothing, so the bar keeps the button.
 */
export function nowBarOffersReviewDiff(slotCard: ComposerSlotCard | null): boolean {
  return slotCard !== "next";
}
