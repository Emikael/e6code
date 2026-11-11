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
 * fixed-width, right-aligned columns so a stack of file headers lines up. Each column fits the
 * widest compact count with its sign, "+1.23K", so keep it in step with `formatCompactCount`.
 *
 * `tone="neutral"` drops the addition and deletion hues for lists, tabs and summaries, where the
 * signs carry the meaning and hue is kept for status; the diff body keeps its tint.
 */
export const DiffStat = memo(function DiffStat(props: {
  additions: number;
  deletions: number;
  className?: string;
  notation?: "compact" | "full";
  layout?: "inline" | "aligned";
  tone?: "tinted" | "neutral";
}) {
  const {
    additions,
    deletions,
    className,
    notation = "compact",
    layout = "inline",
    tone = "tinted",
  } = props;
  const neutral = tone === "neutral";
  const format =
    notation === "full" ? (value: number) => value.toLocaleString() : formatCompactCount;
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        layout === "aligned"
          ? "inline-grid grid-cols-[6ch_6ch] gap-2 text-right align-middle"
          : "inline-flex items-center gap-1",
        className,
      )}
    >
      <span className={neutral ? undefined : "text-diff-addition-foreground"}>
        <span aria-hidden="true">{`+${format(additions)}`}</span>
        <span className="sr-only">{additions.toLocaleString()} additions,</span>
      </span>
      <span className={neutral ? undefined : "text-diff-deletion-foreground"}>
        <span aria-hidden="true">{`−${format(deletions)}`}</span>
        <span className="sr-only">{deletions.toLocaleString()} deletions</span>
      </span>
    </span>
  );
});
