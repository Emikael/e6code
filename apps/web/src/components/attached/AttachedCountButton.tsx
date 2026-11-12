import { type AttachedKind, attachedCountLabel } from "~/lib/attachedForAgent";
import { dispatchSnapShotComposerFocus } from "~/lib/desktopSnapShot";

import { Button } from "../ui/button";

/**
 * "1 comment attached": how a panel tab shows what it attached to the next message. The composer
 * is the one ledger of attached items, so the count moves focus there rather than listing them.
 * Renders nothing at zero.
 */
export function AttachedCountButton(props: {
  readonly count: number;
  readonly kind: AttachedKind;
}) {
  if (props.count === 0) return null;
  return (
    <Button size="compact" variant="outline" onClick={dispatchSnapShotComposerFocus}>
      {attachedCountLabel(props.count, props.kind)}
    </Button>
  );
}
