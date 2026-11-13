import type { DoneTodayRow, DoneTodayShell } from "@e6tools/client-runtime/state/done-today";

/**
 * Board 5's meta line under a done thread: "e6code · +66 −13 · settled 14:20",
 * or "· PR #412 merged 11:05" when a pull request linked to it merged today. Line
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
      ? `PR #${merged.number} merged ${input.formatTime(merged.mergedAt)}`
      : `${row.how} ${input.formatTime(row.doneAt)}`,
  );
  return parts.join(" · ");
}

export interface WrapUpRow {
  readonly title: string;
  /** The snooze command accepts it now. */
  readonly snoozable: boolean;
  /** Blocked on an approval or a question, which the snooze command refuses. */
  readonly waitingOnYou: boolean;
}

/**
 * Wrap up's snooze offer. Board 5 says "Snooze both until tomorrow 09:00", but
 * the snooze command refuses a thread waiting on an approval or a question
 * (hiding it would defeat the request). So the button names exactly what it
 * snoozes, and a note says which rows stay and why: `label` is null when
 * nothing listed can be snoozed, `note` is null when everything can.
 */
export function wrapUpSnoozePlan(input: {
  readonly rows: ReadonlyArray<WrapUpRow>;
  readonly whenLabel: string;
}): { readonly label: string | null; readonly note: string | null } {
  const snoozable = input.rows.filter((row) => row.snoozable);
  const kept = input.rows.filter((row) => !row.snoozable);
  const until = `until tomorrow ${input.whenLabel}`;
  const count = snoozable.length;
  let label: string | null = null;
  if (count > 0 && kept.length === 0) {
    label = `Snooze ${count === 1 ? "it" : count === 2 ? "both" : String(count)} ${until}`;
  } else if (count === 1) {
    label = `Snooze ${snoozable[0]!.title} ${until}`;
  } else if (count > 1) {
    label = `Snooze the other ${count} ${until}`;
  }
  let note: string | null = null;
  if (kept.length > 0) {
    note = kept.every((row) => row.waitingOnYou)
      ? "Approvals and questions cannot be snoozed, so they stay open."
      : `${joinTitles(kept.map((row) => row.title))} cannot be snoozed right now.`;
  }
  return { label, note };
}

function joinTitles(titles: ReadonlyArray<string>): string {
  if (titles.length <= 1) return titles[0] ?? "";
  return `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;
}
