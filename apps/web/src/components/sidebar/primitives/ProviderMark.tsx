import type { ProviderDriverKind } from "@e6tools/contracts";
import { Bot } from "lucide-react";
import { PROVIDER_ICON_BY_PROVIDER } from "~/components/chat/providerIconUtils";
import { cn } from "~/lib/utils";

export function ProviderMark({
  provider,
  label,
  className,
}: {
  provider: ProviderDriverKind;
  label: string;
  className?: string;
}) {
  const Icon = PROVIDER_ICON_BY_PROVIDER[provider] ?? Bot;
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center text-sb-muted",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" strokeWidth={1.75} />
    </span>
  );
}
