import {
  TURN_USAGE_ACTIVITY_KIND,
  TurnUsageActivityPayload,
  type OrchestrationThreadActivity,
  type TurnId,
} from "@e6tools/contracts";
import { formatUsd } from "@e6tools/shared/usageFormat";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const decodeTurnUsagePayload = Schema.decodeUnknownOption(TurnUsageActivityPayload);

// Activity payloads keep their identity across store updates, so each record
// decodes once. Stable values let a rebuilt map compare equal entry by entry.
const decodedPayloads = new WeakMap<object, TurnUsageActivityPayload | null>();

function decodeCachedTurnUsage(payload: unknown): TurnUsageActivityPayload | null {
  if (typeof payload !== "object" || payload === null) return null;
  const cached = decodedPayloads.get(payload);
  if (cached !== undefined) return cached;
  const decoded = Option.getOrNull(decodeTurnUsagePayload(payload));
  decodedPayloads.set(payload, decoded);
  return decoded;
}

/**
 * Collects each settled turn's `turn.usage` record. The work log never shows
 * these as rows; they only feed the turn's "Worked for ..." summary.
 */
export function deriveTurnUsageByTurnId(
  activities: ReadonlyArray<Pick<OrchestrationThreadActivity, "kind" | "payload" | "turnId">>,
): ReadonlyMap<TurnId, TurnUsageActivityPayload> {
  const usageByTurnId = new Map<TurnId, TurnUsageActivityPayload>();
  for (const activity of activities) {
    if (activity.kind !== TURN_USAGE_ACTIVITY_KIND || activity.turnId === null) continue;
    const decoded = decodeCachedTurnUsage(activity.payload);
    if (decoded) usageByTurnId.set(activity.turnId, decoded);
  }
  return usageByTurnId;
}

const TOKEN_UNITS = [
  { size: 1e9, suffix: "b" },
  { size: 1e6, suffix: "m" },
  { size: 1e3, suffix: "k" },
] as const;

/** Three significant figures without trailing zeros: `900`, `1.2k`, `48.6k`, `1.25m`. */
function formatCompactTokens(value: number): string {
  for (const [index, unit] of TOKEN_UNITS.entries()) {
    const scaled = value / unit.size;
    if (scaled < 1) continue;
    const rounded = Number(scaled.toFixed(scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2));
    // 999,999 rounds up to 1000k; name it in the next unit instead.
    const larger = TOKEN_UNITS[index - 1];
    if (rounded >= 1000 && larger) {
      return `${Number((value / larger.size).toFixed(2))}${larger.suffix}`;
    }
    return `${rounded}${unit.suffix}`;
  }
  return `${Math.round(value)}`;
}

/** `$0.12`, `≈$0.12` for an estimate, and `<$0.01` below a cent. */
function formatTurnCost(costUsd: number, costSource: TurnUsageActivityPayload["costSource"]) {
  const amount = costUsd < 0.01 ? "<$0.01" : formatUsd(costUsd);
  return costSource === "estimated" ? `≈${amount}` : amount;
}

/**
 * A turn's usage on its own: `48.6k tokens · $0.12`. Turns without a fold row
 * show this beside their final answer instead. Null when there is nothing to show.
 */
export function formatTurnUsage(usage: TurnUsageActivityPayload | undefined): string | null {
  if (!usage || usage.totalTokens <= 0) return null;
  const tokens = `${formatCompactTokens(usage.totalTokens)} tokens`;
  const cost =
    usage.costUsd !== undefined && Number.isFinite(usage.costUsd) && usage.costUsd > 0
      ? ` · ${formatTurnCost(usage.costUsd, usage.costSource)}`
      : "";
  return `${tokens}${cost}`;
}

/**
 * Appends a turn's usage to its fold label:
 * `Worked for 22s · 48.6k tokens · $0.12`. Without usage the label is unchanged.
 */
export function appendTurnUsage(
  label: string,
  usage: TurnUsageActivityPayload | undefined,
): string {
  const formatted = formatTurnUsage(usage);
  return formatted ? `${label} · ${formatted}` : label;
}
