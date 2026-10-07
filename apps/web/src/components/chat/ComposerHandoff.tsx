import { ArrowRightIcon } from "lucide-react";

import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

export function handoffBannerItem(args: {
  readonly id: string;
  readonly sourceTitle: string;
  readonly targetLabel: string;
  readonly busy?: boolean;
  readonly onContinue: () => void;
  readonly onDismiss: () => void;
}): ComposerBannerStackItem {
  return {
    id: args.id,
    variant: "warning",
    priority: "urgent",
    icon: <ArrowRightIcon />,
    title: "Provider limit reached",
    description: `"${args.sourceTitle}" is blocked. Continue with ${args.targetLabel}?`,
    actions: (
      <Button size="xs" variant="ghost" disabled={args.busy === true} onClick={args.onContinue}>
        {args.busy === true ? "Starting…" : `Continue with ${args.targetLabel}`}
      </Button>
    ),
    dismissLabel: "Dismiss provider handoff",
    onDismiss: args.onDismiss,
  };
}
