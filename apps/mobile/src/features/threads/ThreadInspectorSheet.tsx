/**
 * Run details: a sheet over the thread, in web's order. The agent's plan, how
 * full the context window is, what the thread has cost, the working tree's
 * changes, and the lineage of every subagent the thread spawned, with the
 * provider's nearest plan limit last. Only what providers report is shown.
 * Selecting a live subagent offers Stop, which ends that subagent and not the
 * turn; otherwise read-only apart from closing. Web's Run details is the full
 * surface.
 */
import {
  CommandId,
  type EnvironmentId,
  type OrchestrationSession,
  type OrchestrationThreadActivity,
  type ProviderInstanceId,
  type ThreadId,
  type ThreadUsageTotal,
  type VcsStatusResult,
} from "@e6tools/contracts";
import {
  collectProviderUsageLimits,
  type LimitPace,
  mostConstrainedLimit,
} from "@e6tools/shared/usageLimits";
import { describeThreadUsage } from "@e6tools/client-runtime/work-log/turn-usage";
import type { TaskListStep } from "@e6tools/client-runtime/work-log/task-list";
import {
  type AgentPanelModel,
  canStopSubagent,
  deriveAgentPanelModel,
  findSubagent,
  findSubagentStopFailure,
  isActiveSubagentStatus,
  foldSubagentActivities,
  formatSubagentElapsed,
  formatSubagentFileCount,
  type RuntimeSubagent,
  type RuntimeSubagentStatus,
  type SubagentChangedFiles,
  SUBAGENT_FILES_PREVIEW_LIMIT,
  SUBAGENT_STATUS_LABEL,
  type SubagentStatusTone,
  subagentActivityText,
  subagentElapsedIsLive,
  subagentElapsedMs,
  subagentTone,
} from "@e6tools/client-runtime/state/subagentRuntime";
import {
  derivePendingRequests,
  describeSubagentUserRequest,
  subagentUserRequests,
} from "@e6tools/client-runtime/pending-requests";
import { fileBasename, workspaceRelativeFilePath } from "@e6tools/client-runtime/markdown-links";
import {
  type ContextWindowSnapshot,
  deriveLatestContextWindowSnapshot,
  describeContextWindowUsage,
} from "@e6tools/client-runtime/work-log/context-window";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import * as Option from "effect/Option";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type AppSymbolName, SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { providerDisplayLabel } from "../../lib/modelOptions";
import { useMinuteClock } from "../../lib/useMinuteClock";
import { uuidv4 } from "../../lib/uuid";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { TaskListSteps } from "./thread-work-log";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSelectedThreadWorktree } from "../../state/use-selected-thread-worktree";
import { useThreadSelection } from "../../state/use-thread-selection";
import { vcsEnvironment } from "../../state/vcs";
import {
  deriveInspectorLineage,
  deriveRunDetailsPlanSteps,
  type InspectorLineageRow,
  subagentSessionIsLive,
} from "./thread-inspector-lineage";

const EMPTY_ACTIVITIES: ReadonlyArray<OrchestrationThreadActivity> = [];

/** The spawn card's status colors, keyed by the shared status words. Working
    takes Iris (primary), as on web; each colour pairs a dot with its word. */
const STATUS_TEXT_CLASS = {
  approval: "text-warning-foreground",
  question: "text-warning-foreground",
  working: "text-primary-text",
  idle: "text-foreground-muted",
  done: "text-success-foreground",
  failed: "text-danger-foreground",
  stopped: "text-foreground-muted",
} as const satisfies Record<SubagentStatusTone, string>;

const STATUS_DOT_CLASS = {
  approval: "bg-warning-foreground",
  question: "bg-warning-foreground",
  working: "bg-primary-text",
  idle: "bg-foreground-muted",
  done: "bg-success-foreground",
  failed: "bg-danger-foreground",
  stopped: "bg-foreground-muted",
} as const satisfies Record<SubagentStatusTone, string>;

const PHASE_STATE_WORD = {
  pending: "Pending",
  running: "Working",
  done: "Done",
} as const;

const CARD_CLASS_NAME = "overflow-hidden rounded-2xl border border-border-subtle bg-card";

/**
 * Subagent panel model for a thread, memoized by activity-list identity. The
 * thread header reads its live count; the Inspector renders the rest.
 */
export function useThreadSubagentPanelModel(
  activities: ReadonlyArray<OrchestrationThreadActivity> | undefined,
  session: Pick<OrchestrationSession, "status"> | null,
): AgentPanelModel {
  const sessionLive = subagentSessionIsLive(session);
  const source = activities ?? EMPTY_ACTIVITIES;
  return useMemo(
    () =>
      deriveAgentPanelModel({
        agents: foldSubagentActivities(source, { sessionLive }),
        // A subagent a pending request names reads "Needs approval" or "Needs your answer".
        waitingOn: subagentUserRequests(derivePendingRequests(source)),
      }),
    [sessionLive, source],
  );
}

type ThreadInspectorSheetProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
}>;

export function ThreadInspectorSheet(_props: ThreadInspectorSheetProps) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { selectedThread, selectedThreadDetailState } = useThreadSelection();
  const { selectedThreadCwd } = useSelectedThreadWorktree();
  const detail = Option.getOrNull(selectedThreadDetailState.data);
  const model = useThreadSubagentPanelModel(detail?.activities, selectedThread?.session ?? null);
  const lineage = useMemo(() => deriveInspectorLineage(model), [model]);
  const activities = detail?.activities;
  const contextWindow = useMemo(
    () => (activities ? deriveLatestContextWindowSnapshot(activities) : null),
    [activities],
  );
  const latestTurnId = detail?.latestTurn?.turnId ?? null;
  const planSteps = useMemo(
    () => (activities ? deriveRunDetailsPlanSteps(activities, latestTurnId) : null),
    [activities, latestTurnId],
  );
  const gitStatus = useEnvironmentQuery(
    selectedThread !== null && selectedThreadCwd !== null
      ? vcsEnvironment.status({
          environmentId: selectedThread.environmentId,
          input: { cwd: selectedThreadCwd },
        })
      : null,
  );
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const onSelectAgent = useCallback(
    (agentId: string) => setSelectedAgentId((current) => (current === agentId ? null : agentId)),
    [],
  );
  const providerInstanceId =
    selectedThread?.session?.providerInstanceId ??
    selectedThread?.modelSelection.instanceId ??
    null;
  const subagentStop = useSubagentStop({
    environmentId: selectedThread?.environmentId ?? null,
    threadId: selectedThread?.id ?? null,
    providerInstanceId,
    activities: detail?.activities ?? EMPTY_ACTIVITIES,
    model,
  });

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ sheetCornerRadius: 28 }} />
          {/* iOS draws its native grabber (sheetGrabberVisible); Android needs one drawn. */}
          <View
            importantForAccessibility="no-hide-descendants"
            className="items-center pt-2.5 pb-1"
          >
            <View className="h-1 w-8 rounded-full bg-foreground-muted/40" />
          </View>
        </>
      ) : null}
      <View
        className="flex-row items-center gap-3 pr-4 pl-5"
        style={{ paddingTop: Platform.OS === "ios" ? 18 : 6, paddingBottom: 8 }}
      >
        <Text
          accessibilityRole="header"
          className="min-w-0 flex-1 font-e6-bold text-xl text-foreground"
          numberOfLines={1}
        >
          Run details
        </Text>
        <Pressable
          accessibilityLabel="Close run details"
          accessibilityRole="button"
          // Android's 48dp target around the 31.5dp circle.
          hitSlop={Platform.OS === "android" ? 9 : 4}
          onPress={() => navigation.goBack()}
          className="h-9 w-9 items-center justify-center rounded-full bg-subtle active:bg-subtle-strong"
        >
          <SymbolView
            name="xmark"
            size={14}
            weight="semibold"
            tintColorClassName="accent-icon"
            type="monochrome"
          />
        </Pressable>
      </View>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerClassName="gap-2 px-4 pt-2"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {planSteps ? <PlanCard steps={planSteps} /> : null}
        {contextWindow ? <ContextCard snapshot={contextWindow} /> : null}
        <ThreadCostCard usageTotal={selectedThread?.usageTotal} />
        {selectedThreadCwd !== null ? <ChangesCard status={gitStatus.data} /> : null}
        {lineage.rows.length > 0 ? (
          <>
            <Text
              accessibilityRole="header"
              className="px-1 pt-3 pb-1 font-e6-medium text-sm text-foreground-muted"
              numberOfLines={1}
            >
              {lineage.label}
            </Text>
            <View className={cn(CARD_CLASS_NAME, "py-1")}>
              {lineage.rows.map((row) => (
                <LineageRow
                  key={row.key}
                  row={row}
                  selected={row.kind === "agent" && row.agent.id === selectedAgentId}
                  onSelect={onSelectAgent}
                  workspaceRoot={selectedThreadCwd}
                  stop={
                    row.kind === "agent" &&
                    row.agent.id === selectedAgentId &&
                    subagentStop.canStop(row.agent)
                      ? {
                          pending: subagentStop.pendingIds.has(row.agent.id),
                          onStop: subagentStop.stop,
                        }
                      : null
                  }
                />
              ))}
            </View>
          </>
        ) : null}
        <PlanLimitCard
          environmentId={selectedThread?.environmentId ?? null}
          providerInstanceId={providerInstanceId}
        />
        {detail === null ? (
          <Text className="px-1 pt-1 text-sm text-foreground-muted">Loading activity…</Text>
        ) : !planSteps &&
          !contextWindow &&
          !describeThreadUsage(selectedThread?.usageTotal) &&
          lineage.rows.length === 0 ? (
          <Text className="px-1 pt-1 text-sm leading-normal text-foreground-muted">
            The plan, context, cost and subagents appear here once the agent reports them.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

/**
 * Stop for one subagent. A stop stays pending until the provider settles the
 * subagent; a failure the server records for the request opens an alert.
 */
function useSubagentStop(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
  readonly providerInstanceId: string | null;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly model: AgentPanelModel;
}) {
  const { environmentId, threadId, activities, model } = input;
  const serverConfig = useEnvironmentServerConfig(environmentId);
  const supportsStop =
    serverConfig?.providers.find((provider) => provider.instanceId === input.providerInstanceId)
      ?.supportsSubagentStop === true;
  const stopSubagent = useAtomCommand(threadEnvironment.stopSubagent, { reportFailure: false });
  // The latest stop request per subagent, with the run it targeted.
  const [requests, setRequests] = useState<
    ReadonlyMap<string, { readonly commandId: string; readonly activationCount: number }>
  >(() => new Map());
  const alertedCommandIds = useRef(new Set<string>());

  // A request is pending while its run is still live and no failure is recorded.
  const pendingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [agentId, request] of requests) {
      const agent = findSubagent(model, agentId);
      if (
        agent !== null &&
        isActiveSubagentStatus(agent.status) &&
        agent.activationCount === request.activationCount &&
        findSubagentStopFailure(activities, request.commandId) === null
      ) {
        ids.add(agentId);
      }
    }
    return ids;
  }, [activities, model, requests]);

  useEffect(() => {
    for (const { commandId } of requests.values()) {
      if (alertedCommandIds.current.has(commandId)) continue;
      const failure = findSubagentStopFailure(activities, commandId);
      if (failure === null) continue;
      alertedCommandIds.current.add(commandId);
      Alert.alert("Couldn't stop the subagent", failure);
    }
  }, [activities, requests]);

  const stop = useCallback(
    (agentId: string) => {
      if (!environmentId || !threadId || pendingIds.has(agentId)) return;
      const commandId = CommandId.make(uuidv4());
      const activationCount = findSubagent(model, agentId)?.activationCount ?? 0;
      setRequests((current) => new Map(current).set(agentId, { commandId, activationCount }));
      void stopSubagent({
        environmentId,
        input: { threadId, subagentId: agentId, commandId },
      }).then((result) => {
        if (result._tag !== "Failure") return;
        setRequests((current) => {
          if (current.get(agentId)?.commandId !== commandId) return current;
          const next = new Map(current);
          next.delete(agentId);
          return next;
        });
        Alert.alert("Couldn't stop the subagent", "The server did not accept the stop.");
      });
    },
    [environmentId, model, pendingIds, stopSubagent, threadId],
  );

  return {
    canStop: (agent: RuntimeSubagent) => canStopSubagent(model, agent, supportsStop),
    pendingIds,
    stop,
  };
}

function InfoRow(props: {
  readonly icon: AppSymbolName;
  readonly accessibilityLabel: string;
  readonly children: ReactNode;
}) {
  return (
    <View
      accessible
      accessibilityLabel={props.accessibilityLabel}
      className="min-h-12 flex-row items-center gap-3 px-4 py-3"
    >
      <SymbolView
        name={props.icon}
        size={18}
        tintColorClassName="accent-icon-muted"
        type="monochrome"
      />
      {props.children}
    </View>
  );
}

/** The spawn card's 28pt row tile, tinted by class instead of a theme color. */
function SubagentTile() {
  return (
    <View className="h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-subtle">
      <SymbolView
        name={{ ios: "sparkles", android: "auto_awesome" }}
        size={13}
        weight="medium"
        tintColorClassName="accent-icon-subtle"
        type="monochrome"
      />
    </View>
  );
}

/**
 * The working tree at a glance: line counts and commits to push or pull.
 * Hidden until status arrives and outside Git repositories.
 */
function ChangesCard(props: { readonly status: VcsStatusResult | null }) {
  const { status } = props;
  if (status === null || !status.isRepo) return null;
  const files = status.workingTree.files.length;
  const ahead = status.aheadCount ?? 0;
  const behind = status.behindCount ?? 0;
  const summary = [
    files > 0 ? `${files} ${files === 1 ? "file" : "files"} changed` : "No uncommitted changes",
    ahead > 0 ? `${ahead} to push` : null,
    behind > 0 ? `${behind} to pull` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <View className={CARD_CLASS_NAME}>
      <InfoRow
        icon="doc.text"
        accessibilityLabel={[
          "Changes",
          summary,
          files > 0
            ? `${status.workingTree.insertions} insertions, ${status.workingTree.deletions} deletions`
            : null,
        ]
          .filter(Boolean)
          .join(", ")}
      >
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-base text-foreground">Changes</Text>
          <Text className="text-sm text-foreground-muted" numberOfLines={1}>
            {summary}
          </Text>
        </View>
        {files > 0 ? (
          <LineCounts
            additions={status.workingTree.insertions}
            deletions={status.workingTree.deletions}
          />
        ) : null}
      </InfoRow>
    </View>
  );
}

/** The agent's latest task list, with a done/total count. Each step pairs its icon with a word. */
function PlanCard(props: { readonly steps: ReadonlyArray<TaskListStep> }) {
  const done = props.steps.filter((step) => step.status === "completed").length;
  return (
    <View className={cn(CARD_CLASS_NAME, "gap-2 px-4 py-3")}>
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={`Plan, ${done} of ${props.steps.length} steps done`}
        className="flex-row items-baseline gap-2"
      >
        <Text className="min-w-0 flex-1 text-base text-foreground">Plan</Text>
        <Text className="text-sm tabular-nums text-foreground-muted">
          {done}/{props.steps.length}
        </Text>
      </View>
      <TaskListSteps steps={props.steps} />
    </View>
  );
}

/**
 * How full the context window is, from the latest usage the provider
 * reported. Providers that report none never render this card. The text
 * always states the share, so the warning tint is never the only signal.
 */
function ContextCard(props: { readonly snapshot: ContextWindowSnapshot }) {
  const usage = describeContextWindowUsage(props.snapshot);
  return (
    <View
      accessible
      accessibilityRole={usage.percent !== null ? "progressbar" : undefined}
      accessibilityLabel={usage.accessibilityLabel}
      accessibilityValue={
        usage.percent !== null ? { min: 0, max: 100, now: usage.percent } : undefined
      }
      className={cn(CARD_CLASS_NAME, "flex-row items-start gap-3 px-4 py-3")}
    >
      <SymbolView
        name="chart.bar.xaxis"
        size={18}
        tintColorClassName="accent-icon-muted"
        type="monochrome"
      />
      <View className="min-w-0 flex-1 gap-1">
        <View className="flex-row items-baseline gap-2">
          <Text className="text-base text-foreground">Context</Text>
          <Text
            className="min-w-0 flex-1 text-right text-sm tabular-nums text-foreground-muted"
            numberOfLines={1}
          >
            {usage.label}
          </Text>
        </View>
        {usage.percent !== null ? (
          <View className="mt-1 h-1 overflow-hidden rounded-full bg-foreground-muted/20">
            <View
              className={cn(
                "h-full rounded-full",
                usage.warning ? "bg-warning-foreground" : "bg-foreground-muted",
              )}
              style={{ width: `${usage.percent}%` }}
            />
          </View>
        ) : null}
        {usage.warning || usage.compactionNote ? (
          <Text
            className={cn(
              "text-sm",
              usage.warning ? "text-warning-foreground" : "text-foreground-muted",
            )}
          >
            {[usage.warning ? "Nearly full" : null, usage.compactionNote]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const PACE_SYMBOL = {
  ahead: "arrow.up.right",
  on: "arrow.right.circle",
  under: "arrow.down",
} as const satisfies Record<LimitPace, AppSymbolName>;

/**
 * What the thread has cost across all its turns, summed by the server.
 * Providers report a total, so there is no split. Hidden when none was reported.
 */
function ThreadCostCard(props: { readonly usageTotal: ThreadUsageTotal | undefined }) {
  const usage = describeThreadUsage(props.usageTotal);
  if (!usage) return null;
  return (
    <View className={CARD_CLASS_NAME}>
      <InfoRow icon="bolt.circle" accessibilityLabel={usage.accessibilityLabel}>
        <Text className="text-base text-foreground">This thread</Text>
        <Text
          className="min-w-0 flex-1 text-right text-sm tabular-nums text-foreground-muted"
          numberOfLines={1}
        >
          {usage.tokens}
        </Text>
        {usage.cost ? (
          <Text className="font-mono text-sm tabular-nums text-foreground">{usage.cost}</Text>
        ) : null}
      </InfoRow>
    </View>
  );
}

/**
 * The provider limit the thread is closest to, last in the sheet as on web.
 * Hidden when the provider reports no limits. Pace and remaining quota are
 * always in words, so the warning tint is never the only signal.
 */
function PlanLimitCard(props: {
  readonly environmentId: EnvironmentId | null;
  readonly providerInstanceId: ProviderInstanceId | null;
}) {
  const serverConfig = useEnvironmentServerConfig(props.environmentId);
  // The shared clock ticks only once the limit shows a countdown or pace;
  // the flag is adjusted during render to follow the limit computed below.
  const [countdownShown, setCountdownShown] = useState(false);
  const now = useMinuteClock(countdownShown);
  const limit = useMemo(() => {
    if (props.providerInstanceId === null || !serverConfig) return null;
    const provider = serverConfig.providers.find(
      (candidate) => candidate.instanceId === props.providerInstanceId,
    );
    const report = provider
      ? collectProviderUsageLimits(
          props.providerInstanceId,
          serverConfig.providers,
          serverConfig.usageLimitSources ?? [],
          now,
        )
      : null;
    return provider && report
      ? mostConstrainedLimit(report, providerDisplayLabel(provider), now)
      : null;
  }, [now, props.providerInstanceId, serverConfig]);
  const limitHasCountdown = Boolean(limit?.detail);
  if (countdownShown !== limitHasCountdown) setCountdownShown(limitHasCountdown);
  if (!limit) return null;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={limit.accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: limit.remainingPercent }}
      className={cn(CARD_CLASS_NAME, "flex-row items-start gap-3 px-4 py-3")}
    >
      <SymbolView
        name="chart.bar.xaxis"
        size={18}
        tintColorClassName="accent-icon-muted"
        type="monochrome"
      />
      <View className="min-w-0 flex-1 gap-1">
        <View className="flex-row items-baseline gap-2">
          <Text className="min-w-0 flex-1 text-base text-foreground" numberOfLines={1}>
            {limit.title}
          </Text>
          <Text className="text-sm tabular-nums text-foreground-muted">{limit.remainingLabel}</Text>
        </View>
        <View className="mt-1 h-1 overflow-hidden rounded-full bg-foreground-muted/20">
          <View
            className={cn(
              "h-full rounded-full",
              limit.warning ? "bg-warning-foreground" : "bg-foreground-muted",
            )}
            style={{ width: `${limit.remainingPercent}%` }}
          />
        </View>
        {limit.detail ? (
          <View className="flex-row items-center gap-1.5">
            {limit.pace ? (
              <SymbolView
                name={PACE_SYMBOL[limit.pace]}
                size={12}
                tintColorClassName={
                  limit.warning ? "accent-warning-foreground" : "accent-icon-muted"
                }
                type="monochrome"
              />
            ) : null}
            <Text
              className={cn(
                "min-w-0 flex-1 text-sm tabular-nums",
                limit.warning ? "text-warning-foreground" : "text-foreground-muted",
              )}
              numberOfLines={1}
            >
              {limit.detail}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** "+247 −9", shown only when the counts are known. */
function LineCounts(props: {
  readonly additions: number | null;
  readonly deletions: number | null;
}) {
  if (props.additions === null || props.deletions === null) return null;
  return (
    <>
      <Text className="shrink-0 text-sm tabular-nums text-diff-addition">+{props.additions}</Text>
      <Text className="shrink-0 text-sm tabular-nums text-diff-deletion">−{props.deletions}</Text>
    </>
  );
}

function changedFilesLabel(changedFiles: SubagentChangedFiles): string {
  const count = formatSubagentFileCount(changedFiles.files.length);
  return changedFiles.additions === null || changedFiles.deletions === null
    ? `${count} changed`
    : `${count} changed, ${changedFiles.additions} additions, ${changedFiles.deletions} deletions`;
}

/** The files a selected subagent changed, read-only: diffs open from web. */
function ChangedFilesList(props: {
  readonly changedFiles: SubagentChangedFiles;
  readonly workspaceRoot: string | null;
  readonly indented: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const { files } = props.changedFiles;
  const hidden = files.length - SUBAGENT_FILES_PREVIEW_LIMIT;
  return (
    <View className={cn("gap-1 pr-4 pb-2.5", props.indented ? "pl-[96px]" : "pl-14")}>
      {(showAll ? files : files.slice(0, SUBAGENT_FILES_PREVIEW_LIMIT)).map((file) => {
        const path = workspaceRelativeFilePath(file.path, props.workspaceRoot) ?? file.path;
        const name = fileBasename(path);
        const directory = path.length > name.length ? path.slice(0, -name.length - 1) : "";
        return (
          <View
            key={file.path}
            accessible
            accessibilityLabel={[
              path,
              file.additions === null ? null : `${file.additions} additions`,
              file.deletions === null ? null : `${file.deletions} deletions`,
            ]
              .filter(Boolean)
              .join(", ")}
            className="flex-row items-center gap-2"
          >
            {/* Name and folder both give way; only the counts keep their width. */}
            <Text className="min-w-0 shrink font-mono text-sm text-foreground" numberOfLines={1}>
              {name}
            </Text>
            <Text
              className="min-w-0 flex-1 text-sm text-foreground-muted"
              numberOfLines={1}
              ellipsizeMode="head"
            >
              {directory}
            </Text>
            <LineCounts additions={file.additions} deletions={file.deletions} />
          </View>
        );
      })}
      {hidden > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showAll }}
          onPress={() => setShowAll((value) => !value)}
          style={Platform.OS === "android" ? { minHeight: 48 } : undefined}
          className="min-h-11 justify-center self-start"
        >
          <Text className="font-e6-medium text-sm text-foreground-muted">
            {showAll ? "Show fewer" : `Show ${hidden} more`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const LineageRow = memo(function LineageRow(props: {
  readonly row: InspectorLineageRow;
  readonly selected: boolean;
  readonly onSelect: (agentId: string) => void;
  readonly workspaceRoot: string | null;
  /** Present while this row is selected and its subagent can be stopped. */
  readonly stop: { readonly pending: boolean; readonly onStop: (agentId: string) => void } | null;
}) {
  const { row } = props;
  if (row.kind === "phase") {
    return (
      <View accessible className="flex-row items-center gap-1.5 pt-2.5 pr-4 pb-1 pl-14">
        <Text
          className="min-w-0 shrink font-e6-medium text-sm text-foreground-muted"
          numberOfLines={1}
        >
          {row.title}
        </Text>
        <Text className="shrink-0 text-sm text-foreground-muted">
          · {PHASE_STATE_WORD[row.state]}
        </Text>
      </View>
    );
  }

  const { agent } = row;
  const tone = subagentTone(agent);
  const statusWord = SUBAGENT_STATUS_LABEL[tone];
  const request = agent.waitingOn ? describeSubagentUserRequest(agent.waitingOn) : null;
  const activity = request
    ? [request.text, request.code].filter(Boolean).join(" ")
    : subagentActivityText(agent);
  // A live timer would make this label stale within a second; settled time is final.
  const settledElapsedMs = subagentElapsedIsLive(agent.status) ? null : subagentElapsedMs(agent, 0);
  const { changedFiles } = agent;
  const rowButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      accessibilityLabel={[
        agent.title,
        statusWord,
        activity?.replace(/^▸ /, ""),
        settledElapsedMs === null ? null : formatSubagentElapsed(settledElapsedMs),
        changedFiles ? changedFilesLabel(changedFiles) : null,
      ]
        .filter(Boolean)
        .join(", ")}
      accessibilityHint={
        [
          changedFiles
            ? `Double tap to ${props.selected ? "hide" : "list"} the files it changed.`
            : null,
          props.stop ? "Stop subagent is the next control." : null,
        ]
          .filter(Boolean)
          .join(" ") || undefined
      }
      onPress={() => props.onSelect(agent.id)}
      className={cn(
        "min-h-14 flex-row items-center gap-3 py-2.5 pr-4",
        row.depth === 1 ? "pl-14" : "pl-4",
        props.selected ? "active:opacity-70" : "active:bg-subtle-strong",
      )}
    >
      <SubagentTile />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="font-e6-medium text-[15px] leading-5 text-foreground" numberOfLines={1}>
          {agent.title}
        </Text>
        <View className="flex-row items-center gap-1.5">
          <View className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT_CLASS[tone])} />
          <Text className={cn("shrink-0 font-e6-medium text-sm", STATUS_TEXT_CLASS[tone])}>
            {statusWord}
          </Text>
          <Text className="min-w-0 flex-1 text-sm text-foreground-muted" numberOfLines={1}>
            {activity ? `· ${activity}` : ""}
          </Text>
          <SubagentElapsedText
            status={agent.status}
            startedAt={agent.startedAt}
            completedAt={agent.completedAt}
            updatedAt={agent.updatedAt}
          />
        </View>
        {changedFiles ? (
          <View className="flex-row items-center gap-1.5">
            <Text className="text-sm text-foreground-muted">
              {formatSubagentFileCount(changedFiles.files.length)}
            </Text>
            <LineCounts additions={changedFiles.additions} deletions={changedFiles.deletions} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
  const filesList =
    props.selected && changedFiles ? (
      <ChangedFilesList
        changedFiles={changedFiles}
        workspaceRoot={props.workspaceRoot}
        indented={row.depth === 1}
      />
    ) : null;
  const { stop } = props;
  const stopButton = stop ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        stop.pending ? `Stopping subagent, ${agent.title}` : `Stop subagent, ${agent.title}`
      }
      accessibilityState={{ disabled: stop.pending }}
      disabled={stop.pending}
      onPress={() => stop.onStop(agent.id)}
      style={Platform.OS === "android" ? { minHeight: 48 } : undefined}
      className={cn(
        "min-h-11 flex-row items-center gap-2 pr-4 pb-2 active:opacity-70",
        row.depth === 1 ? "pl-24" : "pl-14",
        stop.pending && "opacity-60",
      )}
    >
      <SymbolView
        name="stop.fill"
        size={13}
        tintColorClassName="accent-danger-foreground"
        type="monochrome"
      />
      <Text className="font-e6-medium text-sm text-danger-foreground">
        {stop.pending ? "Stopping…" : "Stop subagent"}
      </Text>
    </Pressable>
  ) : null;
  if (!props.selected) return rowButton;
  // The selected row, its Stop action and its files read as one block marked
  // by a leading edge. A tinted ground would barely separate from the card in
  // some themes and would pull the status words below text contrast in others.
  return (
    <View>
      <View className="absolute top-0 bottom-0 left-0 w-[3px] bg-focus" />
      {rowButton}
      {stopButton}
      {filesList}
    </View>
  );
});

/**
 * Elapsed time that ticks on its own while the agent runs, so the sheet does
 * not re-render every second. Settled and idle agents stop at their last
 * timestamp (see subagentElapsedMs) and keep no timer.
 */
const SubagentElapsedText = memo(function SubagentElapsedText(
  props: Pick<RuntimeSubagent, "startedAt" | "completedAt" | "updatedAt"> & {
    readonly status: RuntimeSubagentStatus;
  },
) {
  const live = subagentElapsedIsLive(props.status);
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  const elapsedMs = subagentElapsedMs(props, nowMs);
  if (elapsedMs === null) return null;
  return (
    <Text className="shrink-0 pl-1 text-right text-sm tabular-nums text-foreground-muted">
      {formatSubagentElapsed(elapsedMs)}
    </Text>
  );
});
