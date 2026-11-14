import { useAtomValue } from "@effect/atom-react";
import type { RecapTrigger } from "@e6tools/contracts/settings";
import { AsyncResult } from "effect/unstable/reactivity";

import { mobilePreferencesAtom } from "../../state/preferences";

/**
 * The attention settings this device chose (Settings → Thread behavior →
 * Attention), with web's defaults: Needs you on, recap after a break,
 * minutes shown in the thread list.
 * `loaded` is false until preferences are read, so a recap is not decided on
 * the default before the stored choice arrives.
 */
export function useAttentionPreferences(): {
  readonly loaded: boolean;
  readonly needsYouSectionEnabled: boolean;
  readonly recapTrigger: RecapTrigger;
  readonly elapsedTimeEnabled: boolean;
} {
  const result = useAtomValue(mobilePreferencesAtom);
  const preferences = AsyncResult.isSuccess(result) ? result.value : null;
  return {
    // A failed read falls back to the defaults rather than waiting forever.
    loaded: preferences !== null || AsyncResult.isFailure(result),
    needsYouSectionEnabled: preferences?.needsYouSectionEnabled ?? true,
    recapTrigger: preferences?.recapTrigger ?? "after-break",
    elapsedTimeEnabled: preferences?.sidebarElapsedTimeEnabled ?? true,
  };
}
