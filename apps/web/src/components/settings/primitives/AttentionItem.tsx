import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export function AttentionItem({
  icon,
  title,
  detail,
  actionLabel,
  onAction,
  disabled = false,
  tone = "muted",
  className,
}: {
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
  tone?: "muted" | "warning" | "error" | "success";
  className?: string;
}) {
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-3 border-b border-sb-border bg-sb-surface px-3.5 py-3 text-(length:--sb-text-body) text-sb-foreground last:border-b-0",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-sb-hover text-sb-muted [&_svg]:size-4 [&_svg]:stroke-[1.75]",
          tone === "warning" && "text-(--state-approval)",
          tone === "error" && "text-(--state-error)",
          tone === "success" && "text-(--state-completed)",
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 basis-40">
        <div className="font-medium">{title}</div>
        {detail && (
          <div className="mt-0.5 text-(length:--sb-text-meta) text-sb-muted">{detail}</div>
        )}
      </div>
      <Button variant="chip" className="sb-action px-2 py-1" disabled={disabled} onClick={onAction}>
        {actionLabel}
      </Button>
    </li>
  );
}
