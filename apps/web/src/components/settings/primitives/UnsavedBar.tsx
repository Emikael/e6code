import { cloneElement, isValidElement, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export function UnsavedBar({
  onApply,
  onDiscard,
  dirty = true,
  busy = false,
  error,
  shortcut,
  className,
}: {
  onApply: () => void;
  onDiscard: () => void;
  dirty?: boolean;
  busy?: boolean;
  error?: string;
  shortcut?: ReactNode;
  className?: string;
}) {
  if (!dirty) return null;
  return (
    <div
      aria-busy={busy}
      className={cn(
        "sticky bottom-0 flex flex-wrap items-center gap-2 rounded-[12px] border border-sb-border bg-sb-surface p-3 text-(length:--sb-text-body) text-sb-foreground",
        className,
      )}
    >
      <div className="mr-auto" role="status">
        {busy ? "Applying changes…" : "You have unsaved changes"}
        {error && <p className="text-(length:--sb-text-meta) text-(--state-error)">{error}</p>}
      </div>
      <Button variant="secondary" size="compact" disabled={busy} onClick={onDiscard}>
        Discard
      </Button>
      <Button size="compact" disabled={busy} onClick={onApply}>
        Apply{" "}
        {isValidElement<{ className?: string }>(shortcut)
          ? cloneElement(shortcut, {
              className: cn(
                shortcut.props.className,
                "border-primary-foreground/30 bg-transparent text-primary-foreground",
              ),
            })
          : shortcut}
      </Button>
    </div>
  );
}
