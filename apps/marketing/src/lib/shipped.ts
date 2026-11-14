/**
 * Release gate for the landing page. A sentence about an app feature must not
 * reach the live site before the feature does, so each gated part of the page
 * reads one flag here. Each flag is a row of the "Release gating" table in the
 * landing plan. Every feature has landed and ships with this page, so every
 * flag is on. The flags stay so a section can be withheld if a release ever
 * ships without its feature: while a flag is false the page falls back to copy
 * that is true without it and never says "coming soon".
 */
export const shipped = {
  /** The "Approval needed" notification above the hero list. */
  heroNotification: true,
  /** The sub-line's second sentence: notifies you when one is blocked and shows what changed. */
  heroSecondSentence: true,
  /** How it works card: It notifies you. */
  notifiesCard: true,
  /** How it works card: One list of what needs you. */
  oneListCard: true,
  /** How it works card: Where you left off. */
  whereYouLeftOffCard: true,
  /** How it works card: One thread on screen. */
  oneThreadCard: true,
  /** "Review a diff file by file". Without it the review heading is "Every turn is a checkpoint." */
  reviewDiff: true,
  /** "The pull request card shows the next step". */
  prCardNextStep: true,
  /** The Calm by design section and its nav link. */
  calmByDesign: true,
} satisfies Record<string, boolean>;

/** The How it works heading and nav link appear with the first card that ships. */
export const showHowItWorks =
  shipped.notifiesCard ||
  shipped.oneListCard ||
  shipped.whereYouLeftOffCard ||
  shipped.oneThreadCard;
