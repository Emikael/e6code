import { AlarmClock, Archive, ArrowUpDown, Ban, Pin, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import type { SidebarBranchDragVerb } from "../Sidebar.logic";
import { StatusGlyph } from "./primitives/StatusGlyph";
import type { SwitchboardStatus } from "./primitives/status";

const VERB_ICONS: Record<SidebarBranchDragVerb, LucideIcon> = {
  Move: ArrowUpDown,
  Pin,
  Settle: Archive,
  Wake: AlarmClock,
  "Can't move here": Ban,
};

/** Branch-mode drag overlay: glyph, title and the drop verb. It is portaled
 * and may cross the column edge, so it never clips its title to the column.
 * A rejected drop shows its reason as a static tooltip, since a positioned
 * popup cannot track the overlay's per-frame transform. */
export function BranchDragChip({
  status,
  title,
  verb,
  rejectReason,
}: {
  status: SwitchboardStatus;
  title: ReactNode;
  verb: SidebarBranchDragVerb | null;
  rejectReason?: string;
}) {
  const rejected = verb === "Can't move here";
  const VerbIcon = verb ? VERB_ICONS[verb] : null;
  return (
    <div className="pointer-events-none relative inline-flex">
      <div
        data-sb-drag-overlay
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-lg bg-popover px-2.5 text-popover-foreground shadow-lg",
          rejected && "cursor-not-allowed",
        )}
      >
        <StatusGlyph status={status} />
        <span className="max-w-[200px] truncate text-[13px] font-medium">{title}</span>
        {verb && VerbIcon && (
          <span
            data-sb-drag-verb={verb}
            className={cn(
              "inline-flex h-5 shrink-0 items-center gap-1 rounded-[5px] px-1.5 text-[11px] font-semibold",
              rejected
                ? "bg-[color-mix(in_srgb,var(--state-error)_10%,var(--sb-surface))] text-(--state-error)"
                : "bg-sb-selection text-sb-accent-text",
            )}
          >
            <VerbIcon aria-hidden="true" className="size-3 shrink-0" strokeWidth={1.75} />
            {verb}
          </span>
        )}
      </div>
      {rejected && rejectReason && (
        <div
          role="tooltip"
          className="absolute bottom-full left-0 mb-1 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-popover-foreground text-xs shadow-md/5"
        >
          {rejectReason}
        </div>
      )}
    </div>
  );
}
