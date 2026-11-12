import type { DoneTodayRow, DoneTodayShell } from "@e6tools/client-runtime/state/done-today";

/**
 * Board 5's meta line under a done thread: "e6code · +66 −13 · settled 14:20",
 * or "· PR #412 merged 11:05" when a merged pull request is linked. Line
 * totals are left out when the turn changed none.
 */
export function doneTodayMeta(
  row: Pick<DoneTodayRow<DoneTodayShell>, "doneAt" | "how" | "diffStat" | "mergedPullRequest">,
  input: { readonly projectName: string | null; readonly formatTime: (iso: string) => string },
): string {
  const parts: string[] = [];
  if (input.projectName) parts.push(input.projectName);
  const stat = row.diffStat;
  if (stat && (stat.insertions > 0 || stat.deletions > 0)) {
    parts.push(`+${stat.insertions} −${stat.deletions}`);
  }
  const merged = row.mergedPullRequest;
  parts.push(
    merged
      ? `PR #${merged.number} merged ${input.formatTime(merged.mergedAt ?? row.doneAt)}`
      : `${row.how} ${input.formatTime(row.doneAt)}`,
  );
  return parts.join(" · ");
}

/**
 * The Wrap up button: "Snooze both until tomorrow 09:00". It names how many
 * still-open threads it will snooze without a running total.
 */
export function wrapUpSnoozeLabel(count: number, whenLabel: string): string {
  const which = count === 1 ? "it" : count === 2 ? "both" : String(count);
  return `Snooze ${which} until tomorrow ${whenLabel}`;
}
