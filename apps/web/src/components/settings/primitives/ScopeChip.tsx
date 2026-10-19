import { FolderIcon, GlobeIcon, MonitorIcon } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

export function ScopeChip({
  scope,
  name,
  override = false,
  help,
  className,
}: {
  scope: "global" | "environment" | "project";
  name?: string;
  override?: boolean;
  help?: string;
  className?: string;
}) {
  const Icon = scope === "global" ? GlobeIcon : scope === "environment" ? MonitorIcon : FolderIcon;
  const label =
    name ?? (scope === "global" ? "Global" : scope === "environment" ? "Environment" : "Project");
  const chip = (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-[5px] border border-sb-border px-1.5 py-0.5 text-(length:--sb-text-meta) text-sb-muted",
        override && "bg-sb-selection text-sb-accent-text",
        className,
      )}
    >
      <Icon className="size-3 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span className="truncate">
        {label}
        {override && " override"}
      </span>
    </span>
  );
  return help ? (
    <Tooltip>
      <TooltipTrigger render={chip} tabIndex={0} className="rounded-[5px]" />
      <TooltipPopup>{help}</TooltipPopup>
    </Tooltip>
  ) : (
    chip
  );
}
