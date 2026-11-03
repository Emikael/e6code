import { GaugeIcon } from "lucide-react";

import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

/** Banner for a thread whose provider hit its usage limit; the dialog picks the target. */
export function handoffBannerItem(args: {
  readonly id: string;
  readonly sourceProviderLabel: string;
  readonly busy?: boolean;
  readonly onContinue: () => void;
  readonly onDismiss: () => void;
}): ComposerBannerStackItem {
  return {
    id: args.id,
    variant: "warning",
    priority: "urgent",
    icon: <GaugeIcon />,
    title: `${args.sourceProviderLabel} usage limit reached`,
    actions: (
      <Button size="xs" variant="ghost" disabled={args.busy === true} onClick={args.onContinue}>
        {args.busy === true ? "Starting…" : "Continue in new thread…"}
      </Button>
    ),
    dismissLabel: "Dismiss usage limit notice",
    onDismiss: args.onDismiss,
  };
}
