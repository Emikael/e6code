import { RefreshIcon } from "~/components/ui/refresh-icon";
import { useAtomValue } from "@effect/atom-react";
import {
  USAGE_CONTRACT_VERSION,
  type EnvironmentId,
  type UsageProviderKind,
} from "@e6tools/contracts";
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  CircleAlertIcon,
  ChevronDownIcon,
  CircleDashedIcon,
  MinusIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import {
  Fragment,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { refreshUsageLimits } from "@e6tools/client-runtime/state/usage";

import {
  isCompatibleUsageContractVersion,
  isModelCostUnknown,
  type DailyTotals,
  type HourlyTotals,
  type MergedUsage,
} from "@e6tools/shared/usageMerge";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useUsage, type EnvironmentUsageStatus } from "../../state/usage";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  enumerateDays,
  enumerateHourStarts,
  formatCount,
  formatDateTimeShort,
  formatDayShort,
  formatHourShort,
  formatPercent,
  formatTokens,
  formatUsd,
  makeWindow,
} from "@e6tools/shared/usageFormat";
import { cachedInputPercent, sharePercents, tokenSplit } from "@e6tools/shared/usageShares";
import { Button } from "../ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { UsageLimitsSection, UsagePlanLimits } from "./UsageLimits";
import { describePeriodChange, modelCostSplit, previousWindow } from "./usageInsights";
import { UsagePriceOverrides } from "./UsagePriceOverrides";
import { UsageProviderChart, type UsageChartMetric } from "./UsageProviderChart";
import { PROVIDER_ORDER, PROVIDER_PRESENTATION, providersWithUsage } from "./usageProviders";
import {
  readUsagePagePreferences,
  saveUsagePagePreferences,
  type UsagePagePreferences,
} from "./usagePagePreferences";

type UsageMetric = UsageChartMetric | "limits";
const METRIC_OPTIONS = [
  { value: "cost", label: "Cost" },
  { value: "tokens", label: "Tokens" },
  { value: "limits", label: "Limits" },
] as const satisfies readonly { value: UsageMetric; label: string }[];

function isUsageMetric(value: string | null | undefined): value is UsageMetric {
  return METRIC_OPTIONS.some((option) => option.value === value);
}

const WINDOW_OPTIONS = [
  { days: 1, label: "24h" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

function isUsageWindowDays(value: number): value is UsagePagePreferences["windowDays"] {
  return WINDOW_OPTIONS.some((option) => option.days === value);
}

export function UsagePage() {
  const [preferences, setPreferences] = useState(readUsagePagePreferences);
  const [windowSelection, setWindowSelection] = useState(() => ({
    days: preferences.windowDays,
    window: makeWindow(
      preferences.windowDays,
      undefined,
      preferences.windowDays === 1 ? "hour" : "day",
    ),
  }));
  const metric = preferences.metric;
  const showingLimits = metric === "limits";
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [limitsNow, setLimitsNow] = useState(() => Date.now());
  const refreshingRef = useRef(false);
  const [chartView, setChartView] = useState<"chart" | "table">("chart");
  const [selectedEnvironmentIds, setSelectedEnvironmentIds] =
    useState<ReadonlySet<EnvironmentId> | null>(null);
  const { days: windowDays, window } = windowSelection;
  const isPast24Hours = windowDays === 1;
  const { merged, environments, selectedEnvironments, isPending, isPartial, refresh } = useUsage(
    window,
    selectedEnvironmentIds,
  );
  // Same query path and cache key strategy as the main window; it renders
  // nothing until it has answered, so it never holds up the page.
  const previous = useMemo(() => previousWindow(window), [window]);
  const previousUsage = useUsage(previous, selectedEnvironmentIds);
  const periodChange =
    previousUsage.isPending || previousUsage.isPartial || previousUsage.merged.records === 0
      ? null
      : describePeriodChange(
          metric === "tokens" ? merged.totalTokens : merged.costUsd,
          metric === "tokens" ? previousUsage.merged.totalTokens : previousUsage.merged.costUsd,
          isPast24Hours ? "24 hours" : `${windowDays} days`,
        );
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });

  const days = useMemo(
    () => enumerateDays(window.sinceDay, window.untilDay),
    [window.sinceDay, window.untilDay],
  );
  const hours = useMemo(
    () =>
      window.sinceTime === undefined || window.untilTime === undefined
        ? []
        : enumerateHourStarts(window.sinceTime, window.untilTime),
    [window.sinceTime, window.untilTime],
  );
  // Newest first: the window can run 90 periods, so the interesting end
  // belongs at the top of the table.
  const breakdownPeriods = useMemo<readonly (DailyTotals | HourlyTotals)[]>(
    () => (isPast24Hours ? merged.hourly : merged.daily).toReversed(),
    [isPast24Hours, merged.daily, merged.hourly],
  );
  const breakdownModels = useMemo(
    () =>
      metric === "tokens"
        ? merged.models.toSorted(
            (left, right) => right.totalTokens - left.totalTokens || right.costUsd - left.costUsd,
          )
        : merged.models,
    [merged.models, metric],
  );
  const activeProviders = useMemo(() => providersWithUsage(merged.providers), [merged.providers]);
  const timeValueColumnWidth = `${60 / (activeProviders.length + 2)}%`;
  const cacheShare = cachedInputPercent(merged);

  const selectWindow = (days: number) => {
    if (!isUsageWindowDays(days)) return;
    const nextPreferences = { metric, windowDays: days };
    setPreferences(nextPreferences);
    saveUsagePagePreferences(nextPreferences);
    setWindowSelection({
      days,
      window: makeWindow(days, undefined, days === 1 ? "hour" : "day"),
    });
  };
  const refreshLimits = async (automatic = false) => {
    try {
      await Promise.all(
        Array.from(presentations, ([environmentId, presentation]) => {
          if (selectedEnvironmentIds !== null && !selectedEnvironmentIds.has(environmentId)) return;
          if (presentation.connection.phase === "connected" && presentation.serverConfig !== null) {
            return refreshUsageLimits(
              environmentId,
              () => refreshProviders({ environmentId, input: {} }),
              automatic,
            );
          }
        }),
      );
    } finally {
      setLimitsNow(Date.now());
    }
  };
  const selectMetric = (nextMetric: UsageMetric) => {
    if (nextMetric === "limits") {
      setLimitsNow(Date.now());
      void refreshLimits(true);
    }
    const nextPreferences = { metric: nextMetric, windowDays };
    setPreferences(nextPreferences);
    saveUsagePagePreferences(nextPreferences);
  };
  const refreshWindow = () => {
    if (refreshingRef.current) return;

    if (showingLimits) {
      refreshingRef.current = true;
      setIsRefreshing(true);
      void refreshLimits().finally(() => {
        refreshingRef.current = false;
        setIsRefreshing(false);
      });
      return;
    }
    const nextWindow = makeWindow(windowDays, undefined, isPast24Hours ? "hour" : "day");
    if (
      nextWindow.sinceDay !== window.sinceDay ||
      nextWindow.untilDay !== window.untilDay ||
      nextWindow.sinceTime !== window.sinceTime ||
      nextWindow.untilTime !== window.untilTime
    ) {
      setWindowSelection({ days: windowDays, window: nextWindow });
    }
    setLimitsNow(Date.now());
    refreshingRef.current = true;
    setIsRefreshing(true);
    // A shown comparison must not pair a fresh total with a stale previous one.
    void Promise.all([
      refresh(nextWindow),
      periodChange === null ? undefined : previousUsage.refresh(previousWindow(nextWindow)),
    ]).finally(() => {
      refreshingRef.current = false;
      setIsRefreshing(false);
    });
  };
  const connectedLimitsEnvironments = [...presentations]
    .filter(
      ([environmentId, presentation]) =>
        presentation.connection.phase === "connected" &&
        presentation.serverConfig !== null &&
        (selectedEnvironmentIds === null || selectedEnvironmentIds.has(environmentId)),
    )
    .map(([environmentId]) => environmentId)
    .sort()
    .join(",");
  const autoRefreshLimits = useEffectEvent(() => {
    void refreshLimits(true);
  });
  // Every view shows limits (Plan limits on cost and tokens), so the page asks
  // for a fresh check on open and on reaching the Limits tab;
  // `refreshUsageLimits` skips it while a recent one stands.
  useEffect(() => {
    if (connectedLimitsEnvironments) autoRefreshLimits();
  }, [connectedLimitsEnvironments]);

  const windowLabel =
    isPast24Hours && window.sinceTime !== undefined && window.untilTime !== undefined
      ? `${formatDateTimeShort(window.sinceTime, window.timeZone)} to ${formatDateTimeShort(window.untilTime, window.timeZone)}`
      : `${formatDayShort(window.sinceDay)} to ${formatDayShort(window.untilDay)}`;
  const topbarContent = (
    <div className="flex w-full min-w-0 items-center gap-3 py-2">
      <WorkspaceBreadcrumb ariaLabel="Usage breadcrumb" className="min-w-0">
        <WorkspaceBreadcrumbItem>
          <h1>Usage</h1>
        </WorkspaceBreadcrumbItem>
        <WorkspaceBreadcrumbSeparator />
        <WorkspaceBreadcrumbItem current className="min-w-10">
          <UsageEnvironmentFilter
            environments={environments}
            selectedEnvironments={selectedEnvironments}
            selectedEnvironmentIds={selectedEnvironmentIds}
            onSelectionChange={setSelectedEnvironmentIds}
            showUsageStatus={!showingLimits}
            isPartial={isPartial}
            duplicateSources={merged.duplicateSources}
            staleEnvironments={merged.staleEnvironments}
          />
        </WorkspaceBreadcrumbItem>
      </WorkspaceBreadcrumb>
      {!showingLimits ? (
        <span className="ms-auto hidden min-w-0 truncate font-mono text-[11px] text-muted-foreground md:block">
          {windowLabel}
        </span>
      ) : null}
    </div>
  );

  const periodWords = isPast24Hours ? "past 24 hours" : `past ${windowDays} days`;
  const headline = showingLimits
    ? "Usage · plan limits"
    : `Usage · ${metric === "tokens" ? "tokens" : "cost"}, ${periodWords}`;
  const environmentCount = merged.contributingEnvironments.length;
  const meta = [
    `${formatCount(merged.sessions)} ${merged.sessions === 1 ? "session" : "sessions"}`,
    metric !== "cost"
      ? null
      : merged.costQuality.unpricedShare > 0
        ? `API price estimate excludes ${formatPercent(merged.costQuality.unpricedShare)} unpriced records`
        : "API price estimate",
    environmentCount > 0
      ? `${environmentCount} ${environmentCount === 1 ? "environment" : "environments"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const controls = (
    <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
      <ToggleGroup
        aria-label="Usage metric"
        variant="segmented"
        value={[metric]}
        onValueChange={(next) => {
          const value = next[0];
          if (isUsageMetric(value)) selectMetric(value);
        }}
      >
        {METRIC_OPTIONS.map((option) => (
          <Toggle key={option.value} value={option.value}>
            {option.label}
          </Toggle>
        ))}
      </ToggleGroup>
      {/* The period does not apply to Limits, so it stays in place but
          disabled; unmounting it shifted the metric toggle. */}
      <ToggleGroup
        aria-label="Usage period"
        variant="segmented"
        value={[String(windowDays)]}
        disabled={showingLimits}
        onValueChange={(next) => {
          const value = next[0];
          if (value) selectWindow(Number(value));
        }}
      >
        {WINDOW_OPTIONS.map((option) => (
          <Toggle key={option.days} value={String(option.days)}>
            {option.label}
          </Toggle>
        ))}
      </ToggleGroup>
      <Button
        onClick={refreshWindow}
        aria-label={showingLimits ? "Refresh limits" : "Refresh usage"}
        aria-busy={isRefreshing}
        disabled={isRefreshing}
        size="icon-sm"
        variant="ghost"
      >
        <RefreshIcon className="size-3.5" refreshing={isRefreshing} />
      </Button>
    </div>
  );

  const periodNoun = isPast24Hours ? "Hour" : "Day";
  const chartTitle = `${isPast24Hours ? "Hourly" : "Daily"} ${
    metric === "tokens" ? "processed tokens" : "cost"
  }`;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron} className="h-auto">
          {topbarContent}
        </WorkspacePageHeader>

        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="expanded" className="max-w-[88rem] pt-4 pb-10 sm:px-7">
            {selectedEnvironments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {environments.length === 0
                  ? `Connect an environment to see ${showingLimits ? "limits" : "usage"}.`
                  : `Select an environment to see ${showingLimits ? "limits" : "usage"}.`}
              </p>
            ) : (
              <>
                <header className="flex flex-wrap items-end gap-x-6 gap-y-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <h2 className="text-[13px] font-medium text-muted-foreground">{headline}</h2>
                    {showingLimits ? null : isPending ? (
                      <>
                        <Skeleton className="h-14 w-48" />
                        <Skeleton className="h-3.5 w-56" />
                      </>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="font-mono text-5xl font-medium tracking-[-0.04em] text-foreground tabular-nums sm:text-[52px] sm:leading-14">
                            {metric === "cost"
                              ? formatUsd(merged.costUsd)
                              : formatTokens(merged.totalTokens)}
                          </span>
                          {periodChange ? (
                            <span className="flex items-center gap-1 text-[13px] text-muted-foreground">
                              {periodChange.direction === "same" ? (
                                <MinusIcon className="size-3.5 shrink-0" aria-hidden />
                              ) : periodChange.direction === "more" ? (
                                <ArrowUpRightIcon className="size-3.5 shrink-0" aria-hidden />
                              ) : (
                                <ArrowDownRightIcon className="size-3.5 shrink-0" aria-hidden />
                              )}
                              {periodChange.text}
                            </span>
                          ) : null}
                        </div>
                        <span className="font-mono text-[11px] text-muted-foreground">{meta}</span>
                      </>
                    )}
                  </div>
                  {controls}
                </header>

                {showingLimits ? (
                  <UsageLimitsSection
                    selectedEnvironmentIds={selectedEnvironmentIds}
                    now={limitsNow}
                  />
                ) : isPending ? (
                  <UsageSkeleton />
                ) : (
                  <>
                    <ProviderShare
                      providers={activeProviders}
                      totals={merged.providers}
                      metric={metric}
                    />

                    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
                      <UsageCard labelledBy="usage-period-chart" className="gap-3">
                        <div className="flex items-center gap-2">
                          <h2
                            id="usage-period-chart"
                            className="flex-1 text-sm font-semibold text-foreground"
                          >
                            {chartTitle}
                          </h2>
                          <Button
                            size="xs"
                            variant="outline"
                            aria-pressed={chartView === "table"}
                            onClick={() =>
                              setChartView((current) => (current === "chart" ? "table" : "chart"))
                            }
                          >
                            {chartView === "chart" ? "View as table" : "View as chart"}
                          </Button>
                        </div>
                        {chartView === "chart" ? (
                          <UsageProviderChart
                            providers={activeProviders}
                            days={days}
                            daily={merged.daily}
                            hours={hours}
                            hourly={merged.hourly}
                            metric={metric}
                            referenceTime={window.untilTime}
                            resolution={isPast24Hours ? "hour" : "day"}
                            timeZone={window.timeZone}
                          />
                        ) : (
                          <div className="max-h-80 overflow-y-auto">
                            <table className="w-full table-fixed text-sm">
                              <caption className="sr-only">{chartTitle} by provider</caption>
                              <colgroup>
                                <col className="w-2/5" />
                                {activeProviders.map((provider) => (
                                  <col key={provider} style={{ width: timeValueColumnWidth }} />
                                ))}
                                <col style={{ width: timeValueColumnWidth }} />
                                <col style={{ width: timeValueColumnWidth }} />
                              </colgroup>
                              <thead>
                                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                                  <th className="py-2 font-normal">{periodNoun}</th>
                                  {activeProviders.map((provider) => (
                                    <th key={provider} className="py-2 text-right font-normal">
                                      {PROVIDER_PRESENTATION[provider].label}
                                    </th>
                                  ))}
                                  <th className="py-2 text-right font-normal">Total</th>
                                  <th className="py-2 text-right font-normal">Tokens</th>
                                </tr>
                              </thead>
                              <tbody>
                                {breakdownPeriods.length === 0 ? (
                                  <tr>
                                    <td
                                      colSpan={activeProviders.length + 3}
                                      className="py-6 text-center text-muted-foreground"
                                    >
                                      No activity in this window.
                                    </td>
                                  </tr>
                                ) : (
                                  breakdownPeriods.map((period) => (
                                    <tr
                                      key={"hourStart" in period ? period.hourStart : period.day}
                                      className="border-b border-border/50"
                                    >
                                      <td className="py-2 text-foreground">
                                        {"hourStart" in period
                                          ? formatHourShort(period.hourStart, window.timeZone)
                                          : formatDayShort(period.day)}
                                      </td>
                                      {activeProviders.map((provider) => (
                                        <td
                                          key={provider}
                                          className="py-2 text-right font-mono text-xs text-muted-foreground tabular-nums"
                                        >
                                          {formatUsd(period.byProvider.get(provider)?.costUsd ?? 0)}
                                        </td>
                                      ))}
                                      <td className="py-2 text-right font-mono text-xs text-foreground tabular-nums">
                                        {formatUsd(period.costUsd)}
                                      </td>
                                      <td className="py-2 text-right font-mono text-xs text-muted-foreground tabular-nums">
                                        {formatTokens(period.totalTokens)}
                                      </td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </UsageCard>

                      <div className="flex min-w-0 flex-col gap-4">
                        {metric === "cost" ? (
                          <ModelCostSplit models={merged.models} />
                        ) : (
                          <TokenSplit totals={merged} />
                        )}
                        <UsagePlanLimits
                          selectedEnvironmentIds={selectedEnvironmentIds}
                          now={limitsNow}
                          onShowDetails={() => selectMetric("limits")}
                        />
                      </div>
                    </div>

                    <section aria-labelledby="usage-totals">
                      <h2 id="usage-totals" className="sr-only">
                        Totals
                      </h2>
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                        <StatTile
                          value={formatTokens(merged.totalTokens)}
                          label="tokens processed"
                        />
                        <StatTile
                          value={cacheShare === null ? "—" : `${cacheShare}%`}
                          label="of input from cache"
                        />
                        <StatTile value={formatTokens(merged.outputTokens)} label="output tokens" />
                        <StatTile
                          value={formatUsd(merged.costQuality.cacheSavingsUsd)}
                          label="saved by caching"
                          positive={merged.costQuality.cacheSavingsUsd > 0}
                        />
                      </div>
                    </section>

                    {merged.systemOne.environments > 0 &&
                    (merged.systemOne.calls > 0 || merged.systemOne.llmCallsAvoided > 0) ? (
                      <section aria-labelledby="usage-jev" className="flex flex-col gap-2">
                        <h2 id="usage-jev" className="text-sm font-semibold text-foreground">
                          Jev routing
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          Turns routed since the server started. Exact greetings and lookups are
                          answered on the server without a Jev call. Token counts are metered per
                          call; cost scales them by the Jev input price.
                        </p>
                        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                          <StatTile
                            value={String(merged.systemOne.llmCallsAvoided)}
                            label="LLM calls avoided"
                          />
                          <StatTile
                            value={formatTokens(merged.systemOne.jevInputTokens)}
                            label="Jev input tokens"
                          />
                          <StatTile
                            value={formatUsd(merged.systemOne.jevCostUsd)}
                            label="Jev cost"
                          />
                          <StatTile value={String(merged.systemOne.calls)} label="Jev calls" />
                          <StatTile
                            value={`${Math.round(merged.systemOne.avgLatencyMs)} ms`}
                            label="average latency"
                          />
                        </div>
                      </section>
                    ) : null}

                    <section aria-labelledby="usage-models" className="flex flex-col gap-2">
                      <h2 id="usage-models" className="text-sm font-semibold text-foreground">
                        Models
                      </h2>
                      <table className="w-full table-fixed text-sm">
                        <colgroup>
                          <col className="w-2/5" />
                          <col className="w-1/5" />
                          <col className="w-1/5" />
                          <col className="w-1/5" />
                        </colgroup>
                        <thead>
                          <tr className="border-b border-border text-left text-xs text-muted-foreground">
                            <th className="py-2 font-normal">Model</th>
                            <th className="py-2 text-right font-normal">Cost</th>
                            <th className="py-2 text-right font-normal">Share</th>
                            <th className="py-2 text-right font-normal">Tokens</th>
                          </tr>
                        </thead>
                        <tbody>
                          {breakdownModels.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="py-6 text-center text-muted-foreground">
                                No activity in this window.
                              </td>
                            </tr>
                          ) : (
                            breakdownModels.map((model) => (
                              <tr
                                key={`${model.provider}:${model.model}`}
                                className="border-b border-border/50"
                              >
                                <td className="py-2 text-foreground">
                                  <span className="flex min-w-0 items-center gap-2">
                                    <ProviderMark provider={model.provider} className="size-3.5" />
                                    <span className="truncate">{model.model}</span>
                                  </span>
                                </td>
                                <td className="py-2 text-right font-mono text-xs text-foreground tabular-nums">
                                  {isModelCostUnknown(model) ? (
                                    <span className="font-sans text-muted-foreground">
                                      Unpriced
                                    </span>
                                  ) : (
                                    formatUsd(model.costUsd)
                                  )}
                                </td>
                                <td className="py-2 text-right font-mono text-xs text-muted-foreground tabular-nums">
                                  {isModelCostUnknown(model) ? "—" : formatPercent(model.costShare)}
                                </td>
                                <td className="py-2 text-right font-mono text-xs text-muted-foreground tabular-nums">
                                  {formatTokens(model.totalTokens)}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </section>
                  </>
                )}
              </>
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

/** Brand mark for the harness a row belongs to. */
function ProviderMark({
  provider,
  className,
}: {
  readonly provider: UsageProviderKind;
  readonly className: string;
}) {
  const Mark = PROVIDER_PRESENTATION[provider].mark;
  return <Mark className={cn("shrink-0", className)} aria-hidden />;
}

/** The page's card surface: one step off the panel, hairline edge. */
function UsageCard({
  labelledBy,
  className,
  children,
}: {
  readonly labelledBy: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={cn(
        "flex min-w-0 flex-col rounded-xl border border-border bg-surface-raised p-4.5",
        className,
      )}
    >
      {children}
    </section>
  );
}

/**
 * Each provider's share of the period as one full-width stacked bar, with a
 * legend that carries the name, value and percentage so identity never rests
 * on colour alone.
 */
function ProviderShare({
  providers,
  totals,
  metric,
}: {
  readonly providers: readonly UsageProviderKind[];
  readonly totals: MergedUsage["providers"];
  readonly metric: UsageChartMetric;
}) {
  const rows = providers.map((provider) => {
    const entry = totals.find((candidate) => candidate.provider === provider);
    return {
      provider,
      label: PROVIDER_PRESENTATION[provider].label,
      costUsd: entry?.costUsd ?? 0,
      totalTokens: entry?.totalTokens ?? 0,
      sessions: entry?.sessions ?? 0,
    };
  });
  const percents = sharePercents(
    rows.map((row) => (metric === "cost" ? row.costUsd : row.totalTokens)),
  );
  if (rows.length === 0) return null;
  const summary = `Share of ${metric === "cost" ? "cost" : "tokens"}: ${rows
    .map((row, index) => `${row.label} ${percents[index] ?? 0}%`)
    .join(", ")}`;

  return (
    <div className="flex flex-col gap-3">
      <div role="img" aria-label={summary} className="flex h-2.5 gap-0.5">
        {rows.map((row, index) =>
          (percents[index] ?? 0) > 0 ? (
            <span
              key={row.provider}
              className="rounded-[3px]"
              style={{
                width: `${percents[index]}%`,
                backgroundColor: PROVIDER_PRESENTATION[row.provider].color,
              }}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-7 gap-y-2 text-[13px]">
        {rows.map((row, index) => (
          <li key={row.provider} className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: PROVIDER_PRESENTATION[row.provider].color }}
            />
            <span className="text-foreground">{row.label}</span>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {metric === "cost" ? formatUsd(row.costUsd) : formatTokens(row.totalTokens)} ·{" "}
              {percents[index] ?? 0}% · {formatCount(row.sessions)}{" "}
              {row.sessions === 1 ? "session" : "sessions"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Steps of the foreground ink, largest part darkest: the parts are one
// quantity split, not identities, so they share a hue and the list names each.
const PART_FILL = [
  "bg-foreground",
  "bg-foreground/60",
  "bg-foreground/35",
  "bg-foreground/20",
  "bg-foreground/12",
] as const;

/** The parts of a split as one thin stacked bar over a name / share / amount list. */
function SplitCard({
  id,
  title,
  qualifier,
  parts,
  footnote,
}: {
  readonly id: string;
  readonly title: string;
  readonly qualifier?: string;
  readonly parts: readonly {
    readonly key: string;
    readonly label: ReactNode;
    readonly summaryLabel: string;
    readonly percent: number;
    readonly amount: string;
    readonly sub?: boolean;
  }[];
  readonly footnote?: ReactNode;
}) {
  const barParts = parts.filter((part) => !part.sub);
  const summary = `${title}${qualifier ? ` ${qualifier}` : ""}: ${barParts
    .map((part) => `${part.summaryLabel} ${part.percent}%`)
    .join(", ")}`;
  return (
    <UsageCard labelledBy={id} className="gap-2.5">
      <h2 id={id} className="text-sm font-semibold text-foreground">
        {title}
        {qualifier ? (
          <span className="font-normal text-muted-foreground"> · {qualifier}</span>
        ) : null}
      </h2>
      <div role="img" aria-label={summary} className="flex h-1.5 gap-0.5">
        {barParts.map((part, index) =>
          part.percent > 0 ? (
            <span
              key={part.key}
              className={cn("rounded-[2px]", PART_FILL[Math.min(index, PART_FILL.length - 1)])}
              style={{ width: `${part.percent}%` }}
            />
          ) : null,
        )}
      </div>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 gap-y-1 text-xs">
        {parts.map((part, index) => (
          <Fragment key={part.key}>
            <dt
              className={cn(
                "flex min-w-0 items-center gap-2",
                part.sub ? "ps-4 text-muted-foreground" : "text-foreground",
              )}
            >
              {part.sub ? null : (
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 rounded-[2px]",
                    PART_FILL[Math.min(index, PART_FILL.length - 1)],
                  )}
                />
              )}
              {part.label}
            </dt>
            <dd className="text-right font-mono text-muted-foreground tabular-nums">
              {part.percent}%
            </dd>
            <dd
              className={cn(
                "text-right font-mono tabular-nums",
                part.sub ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {part.amount}
            </dd>
          </Fragment>
        ))}
      </dl>
      {footnote}
    </UsageCard>
  );
}

/** Estimated cost by model; the largest few by name, the rest folded together. */
function ModelCostSplit({ models }: { readonly models: MergedUsage["models"] }) {
  const { parts, unpricedModels } = modelCostSplit(models);
  const footnote =
    unpricedModels > 0 ? (
      <p className="text-[11px] text-muted-foreground">
        {unpricedModels} {unpricedModels === 1 ? "model has" : "models have"} no known price and{" "}
        {unpricedModels === 1 ? "is" : "are"} not counted.
      </p>
    ) : null;
  if (parts.length === 0) {
    return (
      <UsageCard labelledBy="usage-cost-split" className="gap-2.5">
        <h2 id="usage-cost-split" className="text-sm font-semibold text-foreground">
          Where the cost went
          <span className="font-normal text-muted-foreground"> · by model</span>
        </h2>
        <p className="text-xs text-muted-foreground">No priced activity in this window.</p>
        {footnote}
      </UsageCard>
    );
  }
  return (
    <SplitCard
      id="usage-cost-split"
      title="Where the cost went"
      qualifier="by model"
      parts={parts.map((part) => ({
        key: part.key,
        summaryLabel: part.label,
        label: (
          <>
            {part.provider ? <ProviderMark provider={part.provider} className="size-3" /> : null}
            <span className="truncate">{part.label}</span>
          </>
        ),
        percent: part.percent,
        amount: formatUsd(part.costUsd),
      }))}
      footnote={footnote}
    />
  );
}

/** Tokens by kind for the period. Reasoning sits inside output, so it is never a fifth part. */
function TokenSplit({ totals }: { readonly totals: Parameters<typeof tokenSplit>[0] }) {
  const split = tokenSplit(totals);
  if (split.totalTokens === 0) return null;
  const parts = split.parts.map((part) => ({
    key: part.key,
    summaryLabel: part.label,
    label: <span className="truncate">{part.label}</span>,
    percent: part.percent,
    amount: formatTokens(part.tokens),
  }));
  return (
    <SplitCard
      id="usage-token-split"
      title="Where the tokens went"
      qualifier="by kind"
      parts={
        split.reasoning.tokens > 0
          ? [
              ...parts,
              {
                key: "reasoning",
                summaryLabel: "of which reasoning",
                label: <span className="truncate">of which reasoning, % of output</span>,
                percent: split.reasoning.percentOfOutput,
                amount: formatTokens(split.reasoning.tokens),
                sub: true,
              },
            ]
          : parts
      }
    />
  );
}

/** A headline figure in mono over its label in words. */
function StatTile({
  value,
  label,
  positive = false,
}: {
  readonly value: string;
  readonly label: string;
  readonly positive?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-[10px] border border-border bg-surface-raised px-3.5 py-3">
      <span
        className={cn(
          "truncate font-mono text-xl font-medium tabular-nums",
          positive ? "text-success-foreground" : "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/**
 * Explains failed or incompatible environments and deduplicated transcripts.
 * Shown inside the environment filter so arriving results do not move the page.
 */
function UsageCoverageNotice({
  environments,
  duplicateSources,
  staleEnvironments,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly duplicateSources: readonly string[];
  readonly staleEnvironments: readonly string[];
}) {
  const failed = environments.filter((environment) => environment.error !== null);
  const stale = environments.filter((environment) =>
    staleEnvironments.includes(environment.environmentId),
  );
  if (failed.length === 0 && stale.length === 0 && duplicateSources.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 border-t border-border px-2 py-2 text-xs text-muted-foreground">
      {failed.map((environment) => (
        <span key={environment.label}>{environment.label} could not report usage.</span>
      ))}
      {stale.map((environment) => (
        <span key={environment.label}>
          {environment.label} runs an older server version and is excluded from totals.
        </span>
      ))}
      {duplicateSources.length > 0 ? (
        <span>
          Counted once across environments sharing a transcript directory:{" "}
          {duplicateSources.join(", ")}
        </span>
      ) : null}
    </div>
  );
}

/** Environment selection and scan progress share a permanent header control. */
function UsageEnvironmentFilter({
  environments,
  selectedEnvironments,
  selectedEnvironmentIds,
  onSelectionChange,
  showUsageStatus,
  isPartial,
  duplicateSources,
  staleEnvironments,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly selectedEnvironments: readonly EnvironmentUsageStatus[];
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly onSelectionChange: (ids: ReadonlySet<EnvironmentId> | null) => void;
  readonly showUsageStatus: boolean;
  readonly isPartial: boolean;
  readonly duplicateSources: readonly string[];
  readonly staleEnvironments: readonly string[];
}) {
  const [modelPricesOpen, setModelPricesOpen] = useState(false);
  const allSelected = selectedEnvironmentIds === null;
  const label = allSelected
    ? "All environments"
    : selectedEnvironments.length === 1
      ? selectedEnvironments[0]!.label
      : `${selectedEnvironments.length} environments`;
  const pendingCount = selectedEnvironments.filter(
    (environment) =>
      environment.error === null && (environment.isPending || environment.summary === null),
  ).length;
  const hasIssue =
    selectedEnvironments.some((environment) => environment.error !== null) ||
    staleEnvironments.length > 0;

  return (
    <>
      <Menu>
        <MenuTrigger className="group/usage-environment inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-sm text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
          <span className="min-w-0 truncate">{label}</span>
          <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
            {showUsageStatus && pendingCount > 0 ? (
              <>
                <CircleDashedIcon className="size-3.5" aria-hidden />
                <span className="sr-only">
                  {pendingCount} {pendingCount === 1 ? "environment" : "environments"} still
                  scanning
                  {isPartial ? "; totals are partial" : ""}
                </span>
              </>
            ) : showUsageStatus && hasIssue ? (
              <CircleAlertIcon
                className="size-3.5 text-warning-foreground"
                aria-label="Some environments could not report usage"
              />
            ) : (
              <ChevronDownIcon
                className="size-3.5 opacity-0 transition-opacity group-hover/usage-environment:opacity-100 group-focus-visible/usage-environment:opacity-100 group-data-popup-open/usage-environment:opacity-100"
                aria-hidden
              />
            )}
          </span>
        </MenuTrigger>
        <MenuPopup align="start" className="w-80 max-w-[calc(100vw-2rem)]">
          <MenuCheckboxItem
            checked={allSelected}
            closeOnClick={false}
            onCheckedChange={(checked) => onSelectionChange(checked ? null : new Set())}
          >
            All environments
          </MenuCheckboxItem>
          <MenuSeparator />
          {environments.map((environment) => {
            const checked =
              selectedEnvironmentIds === null ||
              selectedEnvironmentIds.has(environment.environmentId);
            const status =
              environment.error !== null
                ? "Unavailable"
                : environment.summary !== null &&
                    !isCompatibleUsageContractVersion(
                      environment.summary.contractVersion,
                      USAGE_CONTRACT_VERSION,
                    )
                  ? "Update required"
                  : environment.summary === null
                    ? "Scanning…"
                    : environment.isPending
                      ? "Refreshing…"
                      : "Ready";
            return (
              <MenuCheckboxItem
                key={environment.environmentId}
                checked={checked}
                closeOnClick={false}
                className="grid-cols-[1rem_minmax(0,1fr)]"
                onCheckedChange={(nextChecked) => {
                  const next = new Set(selectedEnvironments.map((entry) => entry.environmentId));
                  if (nextChecked) next.add(environment.environmentId);
                  else next.delete(environment.environmentId);
                  onSelectionChange(next.size === environments.length ? null : next);
                }}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="min-w-0 flex-1 truncate">{environment.label}</span>
                  {showUsageStatus ? (
                    <span
                      className={cn(
                        "shrink-0 text-xs text-muted-foreground",
                        environment.error !== null && "text-destructive",
                      )}
                    >
                      {status}
                    </span>
                  ) : null}
                </span>
              </MenuCheckboxItem>
            );
          })}
          {environments.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">No environments connected.</p>
          ) : null}
          {showUsageStatus && isPartial ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              Totals are partial while selected environments scan.
            </p>
          ) : null}
          {showUsageStatus ? (
            <UsageCoverageNotice
              environments={selectedEnvironments}
              duplicateSources={duplicateSources}
              staleEnvironments={staleEnvironments}
            />
          ) : null}
          <MenuSeparator />
          <MenuItem onClick={() => setModelPricesOpen(true)}>
            <SlidersHorizontalIcon aria-hidden />
            Model prices
          </MenuItem>
        </MenuPopup>
      </Menu>
      {modelPricesOpen ? (
        <UsagePriceOverrides
          usage={environments}
          initialSelectedEnvironmentIds={selectedEnvironmentIds}
          onOpenChange={setModelPricesOpen}
        />
      ) : null}
    </>
  );
}

/**
 * Stand-in with the loaded page's shape below the header, using the shared
 * `Skeleton` bars so it breathes with the same `animate-skeleton` pulse as
 * every other loading state. Replaced by results as soon as the first
 * environment answers.
 */
function UsageSkeleton() {
  return (
    <>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-2.5 w-full" />
        <div className="flex flex-wrap gap-x-7 gap-y-2">
          {PROVIDER_ORDER.map((provider) => (
            <Skeleton key={provider} className="h-4 w-36" />
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-4.5">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="ml-14 h-60 bg-muted-foreground/10" />
        </div>
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-4.5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-1.5 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {["tokens processed", "of input from cache", "output tokens", "saved by caching"].map(
          (label) => (
            <div
              key={label}
              className="flex flex-col gap-1 rounded-[10px] border border-border bg-surface-raised px-3.5 py-3"
            >
              <Skeleton className="h-6 w-16" />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ),
        )}
      </div>
    </>
  );
}
