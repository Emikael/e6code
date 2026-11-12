import { DEFAULT_CLIENT_SETTINGS } from "@e6tools/contracts/settings";

/**
 * Who sees the one-time "What changed" card (F13). It is for people who used
 * E6 Code before the attention redesign, so new defaults (notifications for
 * blocked agents among them) do not arrive unannounced. A profile that has
 * never dismissed it and has a thread older than the redesign is such a
 * person; a fresh install has none and never sees it.
 */
export const ATTENTION_REDESIGN_AT = "2026-11-12T00:00:00.000Z";

export function shouldShowWhatChanged(input: {
  readonly dismissed: boolean;
  readonly threads: ReadonlyArray<{ readonly createdAt: string }>;
}): boolean {
  if (input.dismissed) return false;
  const cutoff = Date.parse(ATTENTION_REDESIGN_AT);
  return input.threads.some((thread) => Date.parse(thread.createdAt) < cutoff);
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
