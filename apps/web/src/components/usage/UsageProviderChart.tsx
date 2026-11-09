import type { UsageProviderKind } from "@e6tools/contracts";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { DailyTotals, HourlyTotals } from "@e6tools/shared/usageMerge";
import {
  formatDayShort,
  formatHourShort,
  formatRelativeHourShort,
  formatTokens,
  formatUsd,
} from "@e6tools/shared/usageFormat";
import { PROVIDER_ORDER, PROVIDER_PRESENTATION } from "./usageProviders";

const TICK_COUNT = 3;
/** Above this many bars, per-bar totals collide; the hover readout and table still carry them. */
const MAX_VALUE_LABELS = 14;
/** Roughly how many period labels fit under the plot at any width. */
const MAX_PERIOD_LABELS = 8;

export type UsageChartMetric = "tokens" | "cost";

interface UsageProviderChartProps {
  readonly providers: readonly UsageProviderKind[];
  readonly days: readonly string[];
  readonly daily: readonly DailyTotals[];
  readonly hours: readonly string[];
  readonly hourly: readonly HourlyTotals[];
  readonly metric: UsageChartMetric;
  readonly referenceTime: string | undefined;
  readonly resolution: "day" | "hour";
  readonly timeZone: string;
}

/** One period's per-provider values, shared by the bars and the hover readout. */
interface DayColumn {
  readonly bands: readonly {
    readonly provider: UsageProviderKind;
    readonly value: number;
  }[];
  readonly total: number;
}

function valueFor(
  totals: DailyTotals | HourlyTotals | undefined,
  provider: UsageProviderKind,
  metric: UsageChartMetric,
): number {
  const entry = totals?.byProvider.get(provider);
  if (entry === undefined) return 0;
  return metric === "tokens" ? entry.totalTokens : entry.costUsd;
}

export function buildPeriodColumns(
  periods: readonly string[],
  byPeriod: ReadonlyMap<string, DailyTotals | HourlyTotals>,
  metric: UsageChartMetric,
): readonly DayColumn[] {
  return periods.map((period) => {
    const entry = byPeriod.get(period);
    const bands = PROVIDER_ORDER.map((provider) => ({
      provider,
      value: valueFor(entry, provider, metric),
    }));
    return { bands, total: bands.reduce((sum, band) => sum + band.value, 0) };
  });
}

/**
 * Builds a scale whose maximum is a readable 1/2/5 x 10^n step at or above the
 * peak.
 *
 * Rounding the maximum *up* is the point: stopping at the last step below the
 * peak leaves the tallest day drawn past the top of the plot, where it is
 * clipped.
 */
export function niceScale(peak: number, count: number): { max: number; ticks: readonly number[] } {
  if (peak <= 0) return { max: 0, ticks: [0] };

  const rawStep = peak / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized > 5 ? 10 : normalized > 2 ? 5 : normalized > 1 ? 2 : 1) * magnitude;

  const max = Math.ceil(peak / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 1e-6; value += step) ticks.push(value);
  return { max, ticks };
}

/** `$8` for whole-dollar ticks, so the axis stays quieter than the bar labels. */
function formatTick(value: number, metric: UsageChartMetric): string {
  if (metric === "tokens") return formatTokens(value);
  return Number.isInteger(value) ? `$${value.toLocaleString("en-US")}` : formatUsd(value);
}

/**
 * Per-period totals as bars stacked by provider, in the provider series
 * colours. The legend above the card names each colour; totals sit on the
 * bars when there is room, and the hover readout lists every provider.
 */
export function UsageProviderChart({
  providers,
  days,
  daily,
  hours,
  hourly,
  metric,
  referenceTime,
  resolution,
  timeZone,
}: UsageProviderChartProps) {
  const periods = resolution === "hour" ? hours : days;
  const byPeriod = useMemo(
    () =>
      resolution === "hour"
        ? new Map(hourly.map((entry) => [entry.hourStart, entry]))
        : new Map(daily.map((entry) => [entry.day, entry])),
    [daily, hourly, resolution],
  );
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const hoverPositionRef = useRef<{ x: number; y: number } | null>(null);

  const { columns, max, ticks, peakIndex } = useMemo(() => {
    const built = buildPeriodColumns(periods, byPeriod, metric);
    // Stacked bars measure from zero to the column total, so the scale tops
    // out at the largest total.
    let peak = 0;
    let peakAt = -1;
    built.forEach((column, index) => {
      if (column.total > peak) {
        peak = column.total;
        peakAt = index;
      }
    });
    const scale = niceScale(peak, TICK_COUNT);
    return { columns: built, max: scale.max, ticks: scale.ticks, peakIndex: peakAt };
  }, [byPeriod, metric, periods]);

  const format = metric === "tokens" ? formatTokens : formatUsd;
  const toPercent = (value: number) => (max === 0 ? 0 : (value / max) * 100);

  const positionTooltip = useCallback(() => {
    const plot = plotRef.current;
    const tooltip = tooltipRef.current;
    const hoverPosition = hoverPositionRef.current;
    if (plot === null || tooltip === null || hoverPosition === null) return;

    const gap = 12;
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    const plotWidth = plot.clientWidth;
    const plotHeight = plot.clientHeight;
    const preferredLeft =
      hoverPosition.x + gap + tooltipWidth <= plotWidth
        ? hoverPosition.x + gap
        : hoverPosition.x - gap - tooltipWidth;
    const preferredTop =
      hoverPosition.y + gap + tooltipHeight <= plotHeight
        ? hoverPosition.y + gap
        : hoverPosition.y - gap - tooltipHeight;
    const left = Math.min(Math.max(0, preferredLeft), Math.max(0, plotWidth - tooltipWidth));
    const top = Math.min(Math.max(0, preferredTop), Math.max(0, plotHeight - tooltipHeight));
    plot.style.setProperty("--usage-tooltip-left", `${left}px`);
    plot.style.setProperty("--usage-tooltip-top", `${top}px`);
  }, []);

  useLayoutEffect(() => {
    if (hoverIndex === null) return;
    positionTooltip();

    const plot = plotRef.current;
    const tooltip = tooltipRef.current;
    if (plot === null || tooltip === null || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(positionTooltip);
    observer.observe(plot);
    observer.observe(tooltip);
    return () => observer.disconnect();
  }, [hoverIndex, positionTooltip]);

  const handleMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const plot = plotRef.current;
      if (plot === null || periods.length === 0) return;
      const bounds = plot.getBoundingClientRect();
      if (bounds.width === 0) return;
      const localX = Math.min(bounds.width, Math.max(0, event.clientX - bounds.left));
      const localY = Math.min(bounds.height, Math.max(0, event.clientY - bounds.top));
      const index = Math.floor((localX / bounds.width) * periods.length);
      hoverPositionRef.current = { x: localX, y: localY };
      positionTooltip();
      setHoverIndex(Math.min(periods.length - 1, Math.max(0, index)));
    },
    [periods.length, positionTooltip],
  );

  const hoveredPeriod = hoverIndex === null ? undefined : periods[hoverIndex];
  const hoveredColumn = hoverIndex === null ? undefined : columns[hoverIndex];
  const formatPeriod = (period: string) =>
    resolution === "hour" ? formatHourShort(period, timeZone) : formatDayShort(period);
  const formatTooltipPeriod = (period: string) =>
    resolution === "hour" && referenceTime !== undefined
      ? formatRelativeHourShort(period, referenceTime, timeZone)
      : formatPeriod(period);

  const showValues = periods.length <= MAX_VALUE_LABELS;
  const labelEvery = Math.max(1, Math.ceil(periods.length / MAX_PERIOD_LABELS));
  const firstPeriod = periods[0];
  const lastPeriod = periods[periods.length - 1];
  const peakPeriod = periods[peakIndex];
  const summary = `${resolution === "hour" ? "Hourly" : "Daily"} ${
    metric === "tokens" ? "processed tokens" : "cost"
  } stacked by provider${
    firstPeriod !== undefined && lastPeriod !== undefined
      ? `, ${formatPeriod(firstPeriod)} to ${formatPeriod(lastPeriod)}`
      : ""
  }.${
    peakPeriod === undefined
      ? " No activity."
      : ` Highest ${resolution === "hour" ? "hour" : "day"} ${formatPeriod(peakPeriod)} at ${format(
          columns[peakIndex]?.total ?? 0,
        )}.`
  }`;

  return (
    <div className="flex flex-col gap-2">
      {/* Top padding leaves room for the tallest bar's total. */}
      <div className="flex gap-2 pt-6">
        <div aria-hidden className="relative h-52 w-12 shrink-0">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 translate-y-1/2 font-mono text-[11px] text-muted-foreground tabular-nums"
              style={{ bottom: `${toPercent(tick)}%` }}
            >
              {formatTick(tick, metric)}
            </span>
          ))}
        </div>

        <div
          ref={plotRef}
          role="img"
          aria-label={summary}
          className="relative h-52 min-w-0 flex-1"
          onMouseMove={handleMove}
          onMouseLeave={() => {
            hoverPositionRef.current = null;
            setHoverIndex(null);
          }}
        >
          {ticks.map((tick) => (
            <span
              key={tick}
              aria-hidden
              className="absolute inset-x-0 h-px bg-border"
              style={{ bottom: `${toPercent(tick)}%` }}
            />
          ))}

          <div aria-hidden className="absolute inset-0 flex">
            {columns.map((column, index) => (
              <div
                key={periods[index]}
                className="relative flex h-full min-w-0 flex-1 justify-center"
              >
                {hoverIndex === index ? (
                  <span className="absolute inset-y-0 inset-x-[8%] rounded-md bg-foreground/5" />
                ) : null}
                <div className="relative flex h-full w-[58%] max-w-14 flex-col-reverse">
                  {column.bands.map((band) =>
                    band.value > 0 ? (
                      // The 2px top inset is the surface gap between stacked segments.
                      <div
                        key={band.provider}
                        className="relative shrink-0"
                        style={{ height: `${toPercent(band.value)}%` }}
                      >
                        <span
                          className="absolute inset-x-0 top-0.5 bottom-0 rounded-[3px]"
                          style={{ backgroundColor: PROVIDER_PRESENTATION[band.provider].color }}
                        />
                      </div>
                    ) : null,
                  )}
                </div>
                {showValues && column.total > 0 ? (
                  <span
                    className="absolute left-1/2 -translate-x-1/2 font-mono text-[11px] whitespace-nowrap text-foreground tabular-nums"
                    style={{ bottom: `calc(${toPercent(column.total)}% + 4px)` }}
                  >
                    {format(column.total)}
                  </span>
                ) : null}
              </div>
            ))}
          </div>

          {hoveredPeriod === undefined ? null : (
            <div
              ref={tooltipRef}
              className="surface-glass pointer-events-none absolute z-10 min-w-36 max-w-full rounded-xl border border-border/50 px-2.5 py-2 text-xs shadow-lg"
              style={{
                left: "var(--usage-tooltip-left, 0px)",
                top: "var(--usage-tooltip-top, 0px)",
              }}
            >
              <div className="mb-1 text-muted-foreground">{formatTooltipPeriod(hoveredPeriod)}</div>
              {providers.map((provider) => {
                const { label, color } = PROVIDER_PRESENTATION[provider];
                return (
                  <div key={provider} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: color }}
                      />
                      {label}
                    </span>
                    <span className="font-mono text-foreground tabular-nums">
                      {format(
                        hoveredColumn?.bands.find((band) => band.provider === provider)?.value ?? 0,
                      )}
                    </span>
                  </div>
                );
              })}
              <div className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-1">
                <span className="text-muted-foreground">Total</span>
                <span className="font-mono text-foreground tabular-nums">
                  {format(hoveredColumn?.total ?? 0)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div aria-hidden className="relative ms-14 h-4">
        {periods.map((period, index) =>
          index % labelEvery === 0 ? (
            <span
              key={period}
              className="absolute -translate-x-1/2 font-mono text-[11px] whitespace-nowrap text-muted-foreground"
              style={{ left: `${((index + 0.5) / periods.length) * 100}%` }}
            >
              {formatPeriod(period)}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}
