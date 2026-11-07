/**
 * Thread Overview: a sheet over the thread with source control at a glance
 * and the lineage of every subagent the thread spawned. Read-only apart from
 * closing; the web Overview is the full surface.
 */
import type {
  OrchestrationSession,
  OrchestrationThreadActivity,
  VcsStatusResult,
} from "@e6tools/contracts";
import {
  type AgentPanelModel,
  deriveAgentPanelModel,
  foldSubagentActivities,
  formatSubagentElapsed,
  type RuntimeSubagent,
  type RuntimeSubagentStatus,
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
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import * as Option from "effect/Option";
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type AppSymbolName, SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironmentQuery } from "../../state/query";
import { useSelectedThreadWorktree } from "../../state/use-selected-thread-worktree";
import { useThreadSelection } from "../../state/use-thread-selection";
import { vcsEnvironment } from "../../state/vcs";
import {
  deriveInspectorLineage,
  type InspectorLineageRow,
  subagentSessionIsLive,
} from "./thread-inspector-lineage";

const EMPTY_ACTIVITIES: ReadonlyArray<OrchestrationThreadActivity> = [];

/** The spawn card's status colors, keyed by the shared status words. */
const STATUS_TEXT_CLASS = {
  approval: "text-warning-foreground",
  question: "text-warning-foreground",
  working: "text-adaptive-sky-700-300",
  idle: "text-foreground-muted",
  done: "text-adaptive-emerald-700-300",
  failed: "text-danger-foreground",
  stopped: "text-foreground-muted",
} as const satisfies Record<SubagentStatusTone, string>;

const STATUS_DOT_CLASS = {
  approval: "bg-warning-foreground",
  question: "bg-warning-foreground",
  working: "bg-adaptive-sky-600-400",
  idle: "bg-foreground-muted",
  done: "bg-adaptive-emerald-600-400",
  failed: "bg-adaptive-rose-600-400",
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
          Overview
        </Text>
        <Pressable
          accessibilityLabel="Close overview"
          accessibilityRole="button"
          hitSlop={4}
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
        <SourceControlCard
          hasWorkspace={selectedThreadCwd !== null}
          status={gitStatus.data}
          statusFailed={gitStatus.error !== null}
          threadBranch={selectedThread?.branch ?? null}
        />
        <Text
          accessibilityRole="header"
          className="px-1 pt-3 pb-1 font-e6-medium text-sm text-foreground-muted"
          numberOfLines={1}
        >
          {lineage.label}
        </Text>
        {detail === null ? (
          <View className={cn(CARD_CLASS_NAME, "min-h-12 justify-center px-4 py-3")}>
            <Text className="text-sm text-foreground-muted">Loading activity…</Text>
          </View>
        ) : lineage.rows.length === 0 ? (
          <View className={cn(CARD_CLASS_NAME, "items-center gap-1.5 px-6 py-7")}>
            <SubagentTile />
            <Text className="mt-1.5 font-e6-semibold text-base text-foreground">
              No subagents yet
            </Text>
            <Text className="text-center text-sm leading-normal text-foreground-muted">
              When an agent splits work, each subagent appears here with its status and running
              time.
            </Text>
          </View>
        ) : (
          <View className={cn(CARD_CLASS_NAME, "py-1")}>
            {lineage.rows.map((row) => (
              <LineageRow
                key={row.key}
                row={row}
                selected={row.kind === "agent" && row.agent.id === selectedAgentId}
                onSelect={onSelectAgent}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
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

function RowDivider() {
  return <View className="ml-[46px] h-px bg-border-subtle" />;
}

/**
 * Branch, changes and commit for the thread's working tree. Values stay blank
 * until status arrives; without a workspace only the thread's branch is known.
 */
function SourceControlCard(props: {
  readonly hasWorkspace: boolean;
  readonly status: VcsStatusResult | null;
  readonly statusFailed: boolean;
  readonly threadBranch: string | null;
}) {
  const { status } = props;
  if (status !== null && !status.isRepo) return null;
  if (!props.hasWorkspace && props.threadBranch === null) return null;

  const branch = status !== null ? (status.refName ?? "Detached HEAD") : props.threadBranch;
  const ahead = status?.aheadCount ?? 0;
  const behind = status?.behindCount ?? 0;
  const files = status?.workingTree.files.length ?? 0;
  const commitDetail =
    status === null
      ? null
      : files > 0
        ? `${files} ${files === 1 ? "file" : "files"}`
        : ahead > 0
          ? `${ahead} to push`
          : "Nothing to commit";

  return (
    <View className={CARD_CLASS_NAME}>
      <InfoRow
        icon="arrow.triangle.branch"
        accessibilityLabel={[
          branch !== null
            ? `Branch ${branch}`
            : props.statusFailed
              ? "Branch status unavailable"
              : "Checking branch",
          ahead > 0 ? `${ahead} ahead` : null,
          behind > 0 ? `${behind} behind` : null,
        ]
          .filter(Boolean)
          .join(", ")}
      >
        <Text
          className={cn(
            "min-w-0 flex-1 text-base",
            branch === null ? "text-foreground-muted" : "font-mono text-foreground",
          )}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {branch ?? (props.statusFailed ? "Status unavailable" : "Checking…")}
        </Text>
        {ahead > 0 ? (
          <Text className="text-sm tabular-nums text-foreground-muted">↑{ahead}</Text>
        ) : null}
        {behind > 0 ? (
          <Text className="text-sm tabular-nums text-foreground-muted">↓{behind}</Text>
        ) : null}
      </InfoRow>
      {props.hasWorkspace ? (
        <>
          <RowDivider />
          <InfoRow
            icon="doc.text"
            accessibilityLabel={
              status === null
                ? "Changes"
                : `Changes, ${status.workingTree.insertions} insertions, ${status.workingTree.deletions} deletions`
            }
          >
            <Text className="min-w-0 flex-1 text-base text-foreground">Changes</Text>
            {status !== null ? (
              <>
                <Text className="text-sm tabular-nums text-adaptive-emerald-700-300">
                  +{status.workingTree.insertions}
                </Text>
                <Text className="text-sm tabular-nums text-adaptive-rose-700-300">
                  −{status.workingTree.deletions}
                </Text>
              </>
            ) : null}
          </InfoRow>
          <RowDivider />
          <InfoRow
            icon="checkmark.circle"
            accessibilityLabel={commitDetail ? `Commit, ${commitDetail}` : "Commit"}
          >
            <Text className="min-w-0 flex-1 text-base text-foreground">Commit</Text>
            {commitDetail ? (
              <Text className="text-sm text-foreground-muted">{commitDetail}</Text>
            ) : null}
          </InfoRow>
        </>
      ) : null}
    </View>
  );
}

const LineageRow = memo(function LineageRow(props: {
  readonly row: InspectorLineageRow;
  readonly selected: boolean;
  readonly onSelect: (agentId: string) => void;
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      accessibilityLabel={[
        agent.title,
        statusWord,
        activity?.replace(/^▸ /, ""),
        settledElapsedMs === null ? null : formatSubagentElapsed(settledElapsedMs),
      ]
        .filter(Boolean)
        .join(", ")}
      onPress={() => props.onSelect(agent.id)}
      className={cn(
        "min-h-14 flex-row items-center gap-3 py-2.5 pr-4 active:bg-subtle",
        row.depth === 1 ? "pl-14" : "pl-4",
        props.selected && "bg-subtle",
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
      </View>
    </Pressable>
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
