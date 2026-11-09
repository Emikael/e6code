import {
  TURN_USAGE_ACTIVITY_KIND,
  TurnUsageActivityPayload,
  type OrchestrationThreadActivity,
  type ThreadUsageTotal,
  type TurnId,
} from "@e6tools/contracts";
import { formatTokens, formatUsd } from "@e6tools/shared/usageFormat";
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

/** `$0.12`, `≈$0.12` for an estimate, and `<$0.01` below a cent. */
function formatTurnCost(costUsd: number, costSource: TurnUsageActivityPayload["costSource"]) {
  const amount = costUsd < 0.01 ? "<$0.01" : formatUsd(costUsd);
  return costSource === "estimated" ? `≈${amount}` : amount;
}

/**
 * A turn's usage on its own: `48.6K tokens · $0.12`. Turns without a fold row
 * show this beside their final answer instead. Null when there is nothing to show.
 */
export function formatTurnUsage(usage: TurnUsageActivityPayload | undefined): string | null {
  if (!usage || usage.totalTokens <= 0) return null;
  const tokens = `${formatTokens(usage.totalTokens)} tokens`;
  const cost =
    usage.costUsd !== undefined && Number.isFinite(usage.costUsd) && usage.costUsd > 0
      ? ` · ${formatTurnCost(usage.costUsd, usage.costSource)}`
      : "";
  return `${tokens}${cost}`;
}

/**
 * A thread's summed usage for the Overview: `cost` is `$1.84`, `≈$1.84` when
 * some turns were estimated or reported no cost, or null when no turn had a cost; `tokens` is
 * `1.2M tokens`. Null when the thread has no usage to show.
 */
export function describeThreadUsage(total: ThreadUsageTotal | undefined): {
  readonly cost: string | null;
  readonly tokens: string;
  readonly accessibilityLabel: string;
} | null {
  if (!total || total.totalTokens <= 0) return null;
  const tokens = `${formatTokens(total.totalTokens)} tokens`;
  const cost =
    total.costUsd !== undefined && Number.isFinite(total.costUsd) && total.costUsd > 0
      ? formatTurnCost(total.costUsd, total.costSource)
      : null;
  return {
    cost,
    tokens,
    // `estimated` covers turns that reported no cost too, so the sum is only approximate.
    accessibilityLabel: cost
      ? total.costSource === "estimated"
        ? `This thread cost about ${cost.replace("≈", "")}, approximate because some turns were estimated or reported no cost, ${tokens}`
        : `This thread cost ${cost}, ${tokens}`
      : `This thread used ${tokens}`,
  };
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
