import {
  AlarmClockIcon,
  CheckIcon,
  CircleAlertIcon,
  EyeIcon,
  ListChecksIcon,
  MessageCircleQuestionIcon,
  PauseIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import type { ThreadStatusMark, ThreadStatusMarkKind } from "./Sidebar.logic";
import { BlockedDiamond } from "./SidebarNeedsYou";

/** Words take the tone's semantic role; the marker follows through `currentColor`. */
export const THREAD_STATUS_TONE_TEXT: Record<ThreadStatusMark["tone"], string> = {
  live: "text-primary-text",
  warning: "text-warning-foreground",
  muted: "text-muted-foreground",
  success: "text-success-foreground",
  failed: "text-destructive-foreground",
};

/**
 * A thread status's leading mark, drawn from `THREAD_STATUS_MARKS`. Always
 * paired with words, never alone. Glyphs are 14px; dots and the diamond stay
 * 8px wherever they appear, and the live dot carries a 3px halo, as the now
 * bar draws it (board Components, "Thread status").
 */
export function ThreadStatusMarker({
  kind,
  marker,
  className,
}: {
  kind: ThreadStatusMarkKind;
  marker: ThreadStatusMark["marker"];
  /** Glyph sizing, such as `size-3`; defaults to `size-3.5`. */
  className?: string | undefined;
}) {
  switch (marker) {
    case "live":
      return (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full bg-primary ring-3 ring-primary-surface"
        />
      );
    case "diamond":
      return <BlockedDiamond />;
    case "dot":
      return <span aria-hidden className="size-2 shrink-0 rounded-full bg-current" />;
    case "ring":
      return (
        <span aria-hidden className="size-2 shrink-0 rounded-full border-[1.5px] border-current" />
      );
    case "check":
      return <CheckIcon aria-hidden className={cn("size-3.5 shrink-0", className)} />;
    case "icon": {
      const Icon =
        kind === "input"
          ? MessageCircleQuestionIcon
          : kind === "failed"
            ? CircleAlertIcon
            : kind === "woke"
              ? AlarmClockIcon
              : kind === "paused"
                ? PauseIcon
                : kind === "plan"
                  ? ListChecksIcon
                  : EyeIcon;
      return <Icon aria-hidden className={cn("size-3.5 shrink-0", className)} />;
    }
  }
}
