import { DEFAULT_CLIENT_SETTINGS } from "@e6tools/contracts/settings";

/**
 * Who sees the one-time "What changed" card (F13): people who used E6 Code
 * before the attention redesign, so new defaults (notifications for blocked
 * agents among them) do not arrive unannounced. Whether a profile is such a
 * person is decided once, on the first load of a build with the redesign, and
 * stored in `attentionIntroDismissed`: false shows the card, true never does.
 */
export function shouldShowWhatChanged(input: { readonly dismissed: boolean | undefined }): boolean {
  return input.dismissed === false;
}

/**
 * The once-only decision. A profile is existing when it had stored settings at
 * this load, or already has threads once every environment has sent its
 * threads; anything else is fresh and never sees the card. Null means wait:
 * the decision is made already, or settings or threads are still loading.
 */
export function decideAttentionIntro(input: {
  readonly decided: boolean | undefined;
  /** From hydration: null until storage has been read. */
  readonly storedSettingsExisted: boolean | null;
  readonly threadsLoaded: boolean;
  readonly threadCount: number;
}): { readonly attentionIntroDismissed: boolean } | null {
  if (input.decided !== undefined || input.storedSettingsExisted === null) return null;
  if (input.storedSettingsExisted) return { attentionIntroDismissed: false };
  if (!input.threadsLoaded) return null;
  return { attentionIntroDismissed: input.threadCount === 0 };
}

/**
 * "Try the new look" (phase 21) is offered only to a profile still stored with
 * an accent or contrast other than the new Graphite at 120.
 */
export function offersNewLook(input: {
  readonly stockAccent: string;
  readonly appearanceContrast: number;
}): boolean {
  return (
    input.stockAccent !== DEFAULT_CLIENT_SETTINGS.stockAccent ||
    input.appearanceContrast !== DEFAULT_CLIENT_SETTINGS.appearanceContrast
  );
}
