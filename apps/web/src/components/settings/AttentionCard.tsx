import { CheckIcon } from "lucide-react";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import type { AttentionPreset } from "./attentionPresets";

/**
 * One group of the Attention page (board 6): the heading sits inside the card,
 * and rows are divided by full-strength rules.
 */
export function AttentionCard({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="rounded-xl border border-border bg-surface-raised px-4 pt-1 pb-2"
    >
      <h2 id={headingId} className="pt-3 pb-1 text-sm leading-5 font-semibold text-foreground">
        {title}
      </h2>
      <div className="[&>*+*]:border-t [&>*+*]:border-border">{children}</div>
    </section>
  );
}

/**
 * `SettingsRow` sized as board 6's rows: no inset of its own inside the card,
 * a 13px label over a 12px caption, and 12px between text and control.
 */
export const ATTENTION_ROW_CLASS =
  "rounded-none px-0 py-2.5 sm:px-0 [&_h3]:text-[13px] [&_h3]:leading-[18px] [&_p]:max-w-none [&_p]:text-xs [&_p]:leading-4 [&_p]:text-muted-foreground [&>div]:@min-[32rem]/settings-row:gap-3";

const TILES: ReadonlyArray<{
  readonly preset: AttentionPreset;
  readonly title: string;
  readonly description: string;
}> = [
  {
    preset: "quiet",
    title: "Quiet",
    description: "Only what blocks an agent reaches you. No sound. Agent activity stays folded.",
  },
  {
    preset: "standard",
    title: "Standard",
    description: "Blocked agents notify you straight away. Finished work waits for a pause.",
  },
  {
    preset: "detailed",
    title: "Detailed",
    description: "Every update as it happens, live agent activity, sound on.",
  },
];

/**
 * The three starting points. The selected tile follows the current values; when
 * they match none, no tile is selected. Arrow keys move between tiles and
 * Enter or Space applies one, so moving never changes a setting by itself.
 */
export function AttentionStartingPoints({
  selected,
  onSelect,
}: {
  selected: AttentionPreset | null;
  onSelect: (preset: AttentionPreset) => void;
}) {
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusIndex = Math.max(
    0,
    TILES.findIndex((tile) => tile.preset === selected),
  );
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    tileRefs.current[(index + step + TILES.length) % TILES.length]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label="Starting point"
      className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3"
    >
      {TILES.map((tile, index) => {
        const checked = tile.preset === selected;
        return (
          <button
            key={tile.preset}
            ref={(element) => {
              tileRefs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={() => onSelect(tile.preset)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "flex cursor-pointer flex-col gap-1.5 rounded-xl border bg-card p-3 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              checked ? "border-primary-edge ring-1 ring-primary-edge" : "border-input",
            )}
          >
            <span className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 text-sm leading-5 font-semibold text-foreground">
                {tile.title}
              </span>
              {checked ? (
                <CheckIcon aria-hidden className="size-4 shrink-0 text-primary-text" />
              ) : null}
            </span>
            <span className="text-xs leading-4 text-muted-foreground">{tile.description}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Board 6's two-option control: a well with the chosen option raised and
 * outlined. It is one choice, so it is a radio group: Tab reaches the chosen
 * option and arrow keys move and choose, as the starting points do.
 */
export function AttentionSegmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  onChange: (value: T) => void;
}) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const nextIndex = (index + step + options.length) % options.length;
    const next = options[nextIndex];
    if (!next) return;
    optionRefs.current[nextIndex]?.focus();
    onChange(next.value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex shrink-0 gap-0.5 rounded-lg bg-surface-well p-0.5"
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              optionRefs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "h-[26px] cursor-pointer rounded-md px-2.5 text-xs leading-4 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
              checked
                ? "bg-card text-foreground ring-1 ring-inset ring-primary-edge"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
