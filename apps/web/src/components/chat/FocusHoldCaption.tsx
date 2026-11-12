import { useClientSettings } from "~/hooks/useSettings";

/**
 * Under the composer in focus mode (board 3): what focus holds back and what
 * still reaches you. No count. Hidden when the setting does not hold anything.
 */
export function FocusHoldCaption() {
  const holds = useClientSettings((settings) => settings.focusHoldsFinished);
  if (!holds) return null;
  return (
    <p className="px-4 pt-2 text-center text-xs leading-4 text-muted-foreground">
      Finished threads are held until you exit focus. Blocked agents and failures still come
      through.
    </p>
  );
}
