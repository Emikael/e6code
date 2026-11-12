import { useClientSettings } from "~/hooks/useSettings";
import { focusHoldCaption } from "~/threadNotificationPolicy";

/**
 * Under the composer in focus mode (board 3): what focus holds back and what
 * still reaches you. No count. Hidden when focus holds nothing back.
 */
export function FocusHoldCaption() {
  const caption = useClientSettings(focusHoldCaption);
  if (caption === null) return null;
  return <p className="px-4 pt-2 text-center text-xs leading-4 text-muted-foreground">{caption}</p>;
}
