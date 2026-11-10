import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import {
  DEFAULT_STOCK_ACCENT,
  StockAccent,
  type StockAccent as StockAccentId,
} from "@e6tools/contracts/settings";
import { STOCK_ACCENT_PALETTES, type ThemeAppearance } from "@e6tools/shared/themePalettes";
import * as Schema from "effect/Schema";
import { CheckIcon } from "lucide-react";

import { SettingResetButton, useSettingsSearchTarget } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const isStockAccent = Schema.is(StockAccent);

/**
 * Accent swatches for the stock E6 Code theme. Shown disabled, with a note,
 * while another theme is on screen, since only the stock palette reads it.
 */
export function StockAccentSetting(props: {
  readonly value: StockAccentId;
  readonly appearance: ThemeAppearance;
  readonly stockThemeActive: boolean;
  readonly onChange: (accent: StockAccentId) => void;
}) {
  const { value, appearance, stockThemeActive, onChange } = props;
  const { id, title } = searchableSetting("stock-accent");
  const targetRef = useSettingsSearchTarget<HTMLElement>(id);
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      ref={targetRef}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="flex flex-col gap-3 outline-none"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 id={headingId} className="text-sm font-semibold text-foreground">
          {title}
        </h2>
        <p className="text-xs text-muted-foreground">
          {stockThemeActive
            ? "The color of the next action and a working agent. Surfaces stay neutral."
            : "Applies to the E6 Code theme. The active theme brings its own accent."}
        </p>
        {value !== DEFAULT_STOCK_ACCENT ? (
          <span className="self-center">
            <SettingResetButton label="accent" onClick={() => onChange(DEFAULT_STOCK_ACCENT)} />
          </span>
        ) : null}
      </div>
      <RadioGroupPrimitive
        aria-labelledby={headingId}
        value={value}
        disabled={!stockThemeActive}
        onValueChange={(next) => {
          if (isStockAccent(next)) onChange(next);
        }}
        className="flex flex-wrap gap-2"
      >
        {StockAccent.literals.map((accent) => {
          const palette = STOCK_ACCENT_PALETTES[accent];
          return (
            <RadioPrimitive.Root
              key={accent}
              value={accent}
              className="group/accent inline-flex h-[34px] cursor-pointer items-center gap-2 rounded-lg border border-input ps-2 pe-3 text-sm font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-checked:border-primary data-checked:bg-primary-surface data-disabled:cursor-not-allowed data-disabled:opacity-64"
            >
              <span
                aria-hidden
                className="size-[18px] shrink-0 rounded-full ring-1 ring-border"
                style={{ backgroundColor: palette[appearance].primary }}
              />
              {palette.label}
              <CheckIcon
                aria-hidden
                className="size-3.5 shrink-0 text-primary-text group-data-unchecked/accent:hidden"
              />
            </RadioPrimitive.Root>
          );
        })}
      </RadioGroupPrimitive>
    </section>
  );
}
