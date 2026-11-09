import { formatCompactCount } from "@e6tools/shared/usageFormat";
import { memo } from "react";
import { cn } from "~/lib/utils";

export function hasNonZeroStat(stat: { additions: number; deletions: number }): boolean {
  return stat.additions > 0 || stat.deletions > 0;
}

/**
 * Added and removed line counts as "+48 −12", everywhere the web app shows them. The visible counts
 * use a true minus (U+2212), which screen readers do not always voice, so they are hidden and the
 * reader hears "48 additions, 12 deletions" instead.
 *
 * Counts are compact ("1.2K") unless `notation="full"`. `layout="aligned"` puts the two counts in
 * fixed-width, right-aligned columns so a stack of file headers lines up.
 */
export const DiffStat = memo(function DiffStat(props: {
  additions: number;
  deletions: number;
  className?: string;
  notation?: "compact" | "full";
  layout?: "inline" | "aligned";
}) {
  const { additions, deletions, className, notation = "compact", layout = "inline" } = props;
  const format =
    notation === "full" ? (value: number) => value.toLocaleString() : formatCompactCount;
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        layout === "aligned"
          ? "inline-grid grid-cols-[4ch_4ch] gap-2 text-right align-middle"
          : "inline-flex items-center gap-1",
        className,
      )}
    >
      <span className="text-diff-addition-foreground">
        <span aria-hidden="true">{`+${format(additions)}`}</span>
        <span className="sr-only">{additions.toLocaleString()} additions,</span>
      </span>
      <span className="text-diff-deletion-foreground">
        <span aria-hidden="true">{`−${format(deletions)}`}</span>
        <span className="sr-only">{deletions.toLocaleString()} deletions</span>
      </span>
    </span>
  );
});
