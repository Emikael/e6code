import type { ProviderDriverKind } from "@e6tools/contracts";

export interface SidebarUsageProviderWindow {
  readonly id: string;
  readonly kind: "session" | "weekly" | "monthly" | "other";
  readonly label: string;
  readonly usedPercent: number;
  readonly resetsAt?: string | undefined;
}

export interface SidebarUsageProvider {
  readonly instanceId: string;
  readonly driver: ProviderDriverKind;
  readonly displayName?: string | null | undefined;
  readonly enabled: boolean;
  readonly usageLimits?:
    | {
        readonly windows: readonly SidebarUsageProviderWindow[];
        readonly unavailable?: { readonly reason: string } | undefined;
      }
    | undefined;
}

export interface SidebarUsageMeterModel {
  readonly key: string;
  readonly provider: ProviderDriverKind;
  readonly label: string;
  readonly windowLabel: string;
  readonly percent: number | null;
  readonly resetsAt: string | null;
}

const WINDOW_KIND_RANK = { weekly: 0, session: 1, monthly: 2, other: 3 } as const;

function preferredUsageWindow(
  windows: readonly SidebarUsageProviderWindow[],
): SidebarUsageProviderWindow | null {
  let selected: SidebarUsageProviderWindow | null = null;
  for (const window of windows) {
    if (selected === null || WINDOW_KIND_RANK[window.kind] < WINDOW_KIND_RANK[selected.kind]) {
      selected = window;
    }
  }
  return selected;
}

export function selectSidebarUsageMeters(
  providers: readonly SidebarUsageProvider[],
): readonly SidebarUsageMeterModel[] {
  const seen = new Set<string>();
  const meters: SidebarUsageMeterModel[] = [];
  for (const provider of providers) {
    if (!provider.enabled || provider.usageLimits === undefined) continue;
    if (seen.has(provider.instanceId)) continue;
    seen.add(provider.instanceId);
    const unavailable = provider.usageLimits.unavailable?.reason === "unsupported";
    const window = unavailable ? null : preferredUsageWindow(provider.usageLimits.windows);
    meters.push({
      key: provider.instanceId,
      provider: provider.driver,
      label: provider.displayName?.trim() || String(provider.driver),
      windowLabel: window?.label ?? "usage",
      percent: window ? window.usedPercent : null,
      resetsAt: window?.resetsAt ?? null,
    });
  }
  return meters;
}

export function formatUsageReset(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(date);
}

export function usageMeterAccessibleName(
  meter: Pick<SidebarUsageMeterModel, "label" | "windowLabel" | "percent" | "resetsAt">,
  resetLabel: string | null,
): string {
  if (meter.percent === null) {
    return `${meter.label} ${meter.windowLabel}: no usage source`;
  }
  const reset = resetLabel ? `, resets ${resetLabel}` : "";
  return `${meter.label} ${meter.windowLabel} ${Math.round(meter.percent)}% used${reset}`;
}
