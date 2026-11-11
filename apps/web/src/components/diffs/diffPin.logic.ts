import { PROVIDER_DISPLAY_NAMES, type ProviderDriverKind } from "@e6tools/contracts";

/**
 * Whether the Diff tab shows the diff it last applied ("pinned") or the newest one ("live").
 * While the agent works, a newer revision waits behind the Update button so nothing moves under
 * the reader. Once the turn ends, the diff follows the newest revision again, which updates it
 * once. With nothing applied yet, the first revision to arrive is shown.
 */
export function diffPinState(input: {
  readonly agentRunning: boolean;
  readonly appliedRevision: string | null;
  readonly liveRevision: string | null;
}): "live" | "pinned" {
  if (!input.agentRunning || input.appliedRevision === null) return "live";
  return input.appliedRevision === input.liveRevision ? "live" : "pinned";
}

interface FileStat {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

/**
 * How many files differ between the shown diff and the newest one: added, removed, or with other
 * counts. Null when either side lacks per-file counts (older servers).
 */
export function newerChangeCount(
  shown: ReadonlyArray<FileStat> | undefined,
  live: ReadonlyArray<FileStat> | undefined,
): number | null {
  if (!shown || !live) return null;
  const shownByPath = new Map(shown.map((file) => [file.path, file]));
  let count = 0;
  for (const file of live) {
    const before = shownByPath.get(file.path);
    shownByPath.delete(file.path);
    if (!before || before.additions !== file.additions || before.deletions !== file.deletions) {
      count += 1;
    }
  }
  return count + shownByPath.size;
}

/** "2 newer changes are not shown, so nothing moves while you read." */
export function pinnedDiffMessage(count: number | null): string {
  const what =
    count === null || count === 0
      ? "Newer changes are not shown"
      : count === 1
        ? "1 newer change is not shown"
        : `${count} newer changes are not shown`;
  return `${what}, so nothing moves while you read.`;
}

/** "Claude is still working", naming the provider when it is a known one. */
export function stillWorkingLabel(providerName: string | null | undefined): string {
  const name = providerName
    ? PROVIDER_DISPLAY_NAMES[providerName as ProviderDriverKind]
    : undefined;
  return `${name ?? "The agent"} is still working`;
}
