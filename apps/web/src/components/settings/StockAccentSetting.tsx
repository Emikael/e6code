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

import { SettingResetButton, SettingsRow } from "./settingsLayout";
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
  return (
    <SettingsRow
      {...searchableSetting("stock-accent")}
      description={
        stockThemeActive
          ? "The color of the next action and a working agent."
          : "Applies to the E6 Code theme. The active theme brings its own accent."
      }
      resetAction={
        value !== DEFAULT_STOCK_ACCENT ? (
          <SettingResetButton label="accent" onClick={() => onChange(DEFAULT_STOCK_ACCENT)} />
        ) : null
      }
      control={
        <RadioGroupPrimitive
          aria-label="Accent"
          value={value}
          disabled={!stockThemeActive}
          onValueChange={(next) => {
            if (isStockAccent(next)) onChange(next);
          }}
          className="flex flex-wrap gap-1.5"
        >
          {StockAccent.literals.map((accent) => {
            const palette = STOCK_ACCENT_PALETTES[accent];
            return (
              <RadioPrimitive.Root
                key={accent}
                value={accent}
                className="group/accent inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 text-xs font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-checked:border-primary-edge data-checked:bg-primary-surface data-disabled:cursor-not-allowed data-disabled:opacity-64"
              >
                <span
                  aria-hidden
                  className="size-3.5 shrink-0 rounded-full ring-1 ring-border"
                  style={{ backgroundColor: palette[appearance].primary }}
                />
                {palette.label}
                <CheckIcon
                  aria-hidden
                  className="size-3.5 shrink-0 text-primary-text group-data-unchecked/accent:invisible"
                />
              </RadioPrimitive.Root>
            );
          })}
        </RadioGroupPrimitive>
      }
    />
  );
}
