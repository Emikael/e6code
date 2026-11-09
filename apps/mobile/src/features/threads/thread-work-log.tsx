import { QuestionAnswerHistory } from "./QuestionAnswerHistory";
import {
  getQuestionAnswerPreview,
  hasQuestionAnswer,
} from "@e6tools/client-runtime/work-log/user-input";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { type AppSymbolName, SymbolView } from "../../components/AppSymbol";
import type { LegendListRef } from "@legendapp/list/react-native";
import { AnimatedLegendList } from "@legendapp/list/reanimated";
import {
  createContext,
  memo,
  use,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { type ColorValue, Pressable, ScrollView, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { EnvironmentId, ToolActivityIcon } from "@e6tools/contracts";
import { toolActivityFaviconUrl } from "@e6tools/shared/favicon";

import { AppText as Text } from "../../components/AppText";
import { E6Wordmark } from "../../components/E6Wordmark";
import { cn } from "../../lib/cn";
import { THREAD_WORK_ROW_MIN_HEIGHT, type deriveThreadWorkLogSizing } from "../../lib/layout";
import {
  type AgentSpawnSummary,
  type ThreadFeedActivity,
  type ThreadTimelineStep,
  timelineRowStep,
  workEntryRowLabel,
  workEntryRowStats,
} from "../../lib/threadActivity";
import {
  resolveThreadWorkGroupInitialScroll,
  shouldFollowThreadWorkGroupAppend,
  type ThreadWorkGroupScrollPosition,
} from "./thread-feed-live-follow";
import {
  resolveWorkEntryToolPresentation,
  type ToolGroupSummaryKind,
  workEntryViewedImagePath,
} from "@e6tools/client-runtime/work-log/presentation";
import { resolveWorkGroupScrollAnchor } from "@e6tools/client-runtime/work-log/scroll-anchor";
import {
  TASK_LIST_STEP_STATUS_LABELS,
  type TaskListStep,
  type TaskListStepStatus,
} from "@e6tools/client-runtime/work-log/task-list";
import {
  describeSubagentUserRequest,
  type SubagentUserRequest,
} from "@e6tools/client-runtime/pending-requests";
import type { MarkdownImageRenderer } from "../../native/SelectableMarkdownText";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useAssetUrl } from "../../state/assets";
import type { WorkLogDiffStat as WorkLogDiffStatValue } from "@e6tools/client-runtime/work-log/diff-stat";

export const THREAD_DISCLOSURE_TRANSITION_MS = 180;
const WORK_LOG_LAYOUT_TRANSITION = LinearTransition.duration(THREAD_DISCLOSURE_TRANSITION_MS);
const WORK_LOG_DETAIL_ENTER_TRANSITION = FadeIn.duration(140);
const WORK_LOG_DETAIL_EXIT_TRANSITION = FadeOut.duration(120);
type WorkContentIcon = AppSymbolName | "browser" | "device" | "e6-code" | "pull-request";

function WorkLogIcon(props: {
  readonly icon: WorkContentIcon;
  readonly color: ColorValue;
  readonly colorClassName?: string;
}) {
  const colorClassName = props.colorClassName;
  if (props.icon === "e6-code") {
    return (
      <E6Wordmark height={10} {...(colorClassName ? { colorClassName } : { color: props.color })} />
    );
  }
  return (
    <SymbolView
      name={
        props.icon === "pull-request"
          ? "arrow.triangle.pull"
          : props.icon === "browser"
            ? { ios: "globe", android: "public" }
            : props.icon === "device"
              ? { ios: "iphone", android: "smartphone" }
              : props.icon
      }
      size={14}
      weight="medium"
      {...(colorClassName ? { tintColorClassName: colorClassName } : { tintColor: props.color })}
      type="monochrome"
    />
  );
}

export function ThreadDisclosureChevron(props: {
  readonly expanded: boolean;
  readonly collapsedDirection: "right" | "down";
  readonly size: number;
  readonly tintColor: ColorValue;
}) {
  const expandedAngle = props.collapsedDirection === "right" ? 90 : 180;
  const rotation = useSharedValue(props.expanded ? expandedAngle : 0);

  useLayoutEffect(() => {
    rotation.value = withTiming(props.expanded ? expandedAngle : 0, {
      duration: THREAD_DISCLOSURE_TRANSITION_MS,
      reduceMotion: ReduceMotion.System,
    });
  }, [expandedAngle, props.expanded, rotation]);

  const rotationStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[{ width: props.size, height: props.size }, rotationStyle]}
    >
      <SymbolView
        name={props.collapsedDirection === "right" ? "chevron.right" : "chevron.down"}
        size={props.size}
        tintColor={props.tintColor}
        type="monochrome"
      />
    </Animated.View>
  );
}

/**
 * The live work label. It reads as live through static primary text, not a
 * looping sweep, so a running turn costs no frames.
 */
export function LiveWorkContent(props: {
  readonly className?: string;
  readonly textClassName?: string;
  /** Secondary line: no icon slot, caption size. */
  readonly compact?: boolean;
  readonly environmentId?: EnvironmentId;
  readonly icon: WorkContentIcon;
  readonly iconSubtleColor: ColorValue;
  readonly label: string;
  readonly showIcon: boolean;
  readonly themeAppearance?: "light" | "dark";
  readonly toolIcon?: ToolActivityIcon;
}) {
  return (
    <View className={cn("min-w-0 flex-1 flex-row items-center gap-1.5", props.className)}>
      {props.showIcon ? (
        <View className="h-6 w-6 shrink-0 items-center justify-center">
          {props.toolIcon && props.environmentId ? (
            <ToolActivityIconView
              environmentId={props.environmentId}
              icon={props.toolIcon}
              fallback={props.icon}
              fallbackColor={props.iconSubtleColor}
              themeAppearance={props.themeAppearance ?? "light"}
            />
          ) : (
            <WorkLogIcon icon={props.icon} color={props.iconSubtleColor} />
          )}
        </View>
      ) : null}
      <Text
        className={cn(
          "min-w-0 shrink text-primary-text",
          props.compact ? "text-xs" : "text-sm",
          props.textClassName,
        )}
        numberOfLines={1}
      >
        {props.label}
      </Text>
    </View>
  );
}

function workRowSymbolName(icon: ThreadFeedActivity["icon"]): AppSymbolName {
  switch (icon) {
    case "agent":
      return { ios: "sparkles", android: "auto_awesome" };
    case "alert":
      return { ios: "exclamationmark.triangle", android: "error" };
    case "browser":
      return { ios: "safari", android: "public" };
    case "check":
      return { ios: "checkmark", android: "check" };
    case "checklist":
      return "checklist";
    case "command":
      return { ios: "terminal", android: "terminal" };
    case "computer":
      return { ios: "desktopcomputer", android: "desktop_windows" };
    case "edit":
      return { ios: "square.and.pencil", android: "edit" };
    case "eye":
      return { ios: "eye", android: "visibility" };
    case "globe":
      return { ios: "globe", android: "public" };
    case "hammer":
      return { ios: "hammer", android: "construction" };
    case "lock":
      return { ios: "lock", android: "lock" };
    case "message":
      return { ios: "bubble.left", android: "chat_bubble" };
    case "warning":
      return { ios: "xmark", android: "close" };
    case "wrench":
      return { ios: "wrench", android: "build" };
    case "zap":
      return { ios: "bolt", android: "bolt" };
  }
}

// Entering fades only for rows created moments ago: rows remount whenever the
// list scrolls them back into view, and old rows must not replay an entrance.
const FRESH_ROW_WINDOW_MS = 3_000;
function isFreshRow(createdAt: string): boolean {
  const timestamp = Date.parse(createdAt);
  return Number.isFinite(timestamp) && Date.now() - timestamp < FRESH_ROW_WINDOW_MS;
}

// The minimum matches min-h-8 below. Exact sizing is disabled when native
// accessibility scaling can make the single-line text taller than that minimum.
const WORK_ROW_HEIGHT = THREAD_WORK_ROW_MIN_HEIGHT;
const WORK_ROW_GAP = 1; // gap-px
const WORK_LOG_BOTTOM_MARGIN = 3.5; // mb-1 with the mobile 14px rem
const WORK_GROUP_MAX_HEIGHT = 256;
const WORK_GROUP_EDGE_FADE_HEIGHT = 12;

export const WORK_GROUP_TOGGLE_HEIGHT = THREAD_WORK_ROW_MIN_HEIGHT;

function workLogRowsHeight(
  activities: ReadonlyArray<ThreadFeedActivity>,
  rowHeight = WORK_ROW_HEIGHT,
): number {
  return activities.length * rowHeight + Math.max(0, activities.length - 1) * WORK_ROW_GAP;
}

export function collapsedWorkLogHeight(activities: ReadonlyArray<ThreadFeedActivity>): number {
  if (activities.length === 0) {
    return 0;
  }
  const height = workLogRowsHeight(activities);
  return (
    WORK_LOG_BOTTOM_MARGIN +
    (activities[0]?.groupedToolDetail ? Math.min(height, WORK_GROUP_MAX_HEIGHT) : height)
  );
}

interface ThreadWorkLogProps {
  readonly activities: ReadonlyArray<ThreadFeedActivity>;
  readonly anchorKey: string;
  readonly environmentId: EnvironmentId;
  readonly copiedRowId: string | null;
  readonly expandedRows: Readonly<Record<string, boolean>>;
  readonly rowSizing: ReturnType<typeof deriveThreadWorkLogSizing>;
  readonly scrollPositions: Map<string, ThreadWorkGroupScrollPosition>;
  readonly iconSubtleColor: ColorValue;
  /** Feed background, painted as the scroll-edge fade over a long group. */
  readonly edgeFadeColor: string;
  readonly themeAppearance: "light" | "dark";
  readonly onCopyRow: (rowId: string, value: string) => void;
  readonly onToggleRow: (rowId: string, anchorKey: string) => void;
  readonly renderImage: MarkdownImageRenderer;
  /** Draw these rows on the thinking timeline; set only when the setting is on. */
  readonly timelineStep?: ThreadTimelineStep;
}

export function ThreadWorkLog(props: ThreadWorkLogProps) {
  const timelineStep = props.timelineStep;
  const rowHeight = props.rowSizing.estimatedRowHeight;
  const rowCount = props.activities.length;
  // Each row draws its own rail piece around its header dot, so an opened
  // body or a wrapped label never moves where the rail starts or ends.
  const renderRow = useCallback(
    (row: ThreadFeedActivity, index: number) => (
      <View key={row.id} className={index < rowCount - 1 ? "pb-px" : undefined}>
        {timelineStep ? (
          <ThreadTimelineRail
            step={timelineRowStep(timelineStep, index, rowCount)}
            rowHeight={rowHeight}
            trailingGap={0}
            className="left-0.5"
          />
        ) : null}
        <ThreadWorkLogRow
          row={row}
          anchorKey={props.anchorKey}
          copied={props.copiedRowId === row.id}
          expanded={props.expandedRows[row.id] ?? false}
          environmentId={props.environmentId}
          iconSubtleColor={props.iconSubtleColor}
          onCopyRow={props.onCopyRow}
          onToggleRow={props.onToggleRow}
          renderImage={props.renderImage}
          themeAppearance={props.themeAppearance}
          timeline={timelineStep !== undefined}
          rowHeight={rowHeight}
        />
      </View>
    ),
    [
      props.anchorKey,
      props.copiedRowId,
      props.expandedRows,
      props.environmentId,
      props.iconSubtleColor,
      props.onCopyRow,
      props.onToggleRow,
      props.renderImage,
      props.themeAppearance,
      rowCount,
      rowHeight,
      timelineStep,
    ],
  );

  if (rowCount === 0) {
    return null;
  }

  return (
    <View className="-mx-1 mb-1 px-1 py-0">
      {timelineStep === "first" || timelineStep === "middle" ? (
        // The rail crosses this log's bottom margin to the next step's row.
        <ThreadTimelineRailLine
          className="left-1.5"
          style={{ bottom: -WORK_LOG_BOTTOM_MARGIN, height: WORK_LOG_BOTTOM_MARGIN }}
        />
      ) : null}
      {props.activities[0]?.groupedToolDetail ? (
        <ThreadWorkGroupList
          activities={props.activities}
          edgeFadeColor={props.edgeFadeColor}
          expandedRows={props.expandedRows}
          groupId={props.anchorKey}
          rowSizing={props.rowSizing}
          scrollPositions={props.scrollPositions}
          renderRow={renderRow}
        />
      ) : (
        <View>{props.activities.map(renderRow)}</View>
      )}
    </View>
  );
}

function ThreadWorkGroupList(props: {
  readonly activities: ReadonlyArray<ThreadFeedActivity>;
  readonly edgeFadeColor: string;
  readonly expandedRows: Readonly<Record<string, boolean>>;
  readonly groupId: string;
  readonly rowSizing: ReturnType<typeof deriveThreadWorkLogSizing>;
  readonly scrollPositions: Map<string, ThreadWorkGroupScrollPosition>;
  readonly renderRow: (row: ThreadFeedActivity, index: number) => ReactNode;
}) {
  const estimatedRowsHeight = workLogRowsHeight(
    props.activities,
    props.rowSizing.estimatedRowHeight,
  );
  const [initialPosition] = useState(() => {
    const position = props.scrollPositions.get(props.groupId);
    return props.activities.some((row) => row.id === position?.rowId) ? position : undefined;
  });
  const [initialScrollIndex] = useState(() =>
    resolveThreadWorkGroupInitialScroll(props.activities, initialPosition),
  );
  const [restoringPosition, setRestoringPosition] = useState(initialScrollIndex !== undefined);
  const listRef = useRef<LegendListRef>(null);
  const loadedRef = useRef(false);
  const userScrollingRef = useRef(false);
  const pendingAppendHeightRef = useRef<number | null>(null);
  const previousContent = useRef({
    rows: props.activities,
    height: Math.max(estimatedRowsHeight, initialPosition?.contentHeight ?? 0),
    expandedRows: props.expandedRows,
  });
  const [measuredContent, setMeasuredContent] = useState(() => ({
    height: Math.max(estimatedRowsHeight, initialPosition?.contentHeight ?? 0),
    rowCount: props.activities.length,
  }));
  const contentHeight = Math.max(
    1,
    measuredContent.height +
      Math.max(0, props.activities.length - measuredContent.rowCount) *
        (props.rowSizing.estimatedRowHeight + WORK_ROW_GAP),
  );
  const height = Math.min(contentHeight, WORK_GROUP_MAX_HEIGHT);
  const scrollOffset = useSharedValue(initialPosition?.scrollOffset ?? 0);
  const sharedValues = useMemo(() => ({ scrollOffset }), [scrollOffset]);

  // Each edge fades only while content continues past it. Scroll offset stays
  // on the UI thread; only content-size changes update React state.
  const topFadeStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, scrollOffset.value) / WORK_GROUP_EDGE_FADE_HEIGHT),
  }));
  const bottomFadeStyle = useAnimatedStyle(() => ({
    opacity: Math.min(
      1,
      Math.max(0, contentHeight - height - scrollOffset.value) / WORK_GROUP_EDGE_FADE_HEIGHT,
    ),
  }));
  const rememberPosition = useCallback(() => {
    if (!loadedRef.current) return;
    const state = listRef.current?.getState();
    const position = state && resolveWorkGroupScrollAnchor(state);
    if (!state || !position) return;
    props.scrollPositions.set(props.groupId, {
      ...position,
      contentHeight: state.contentLength,
    });
  }, [props.groupId, props.scrollPositions]);
  const finishPendingAppend = useCallback(() => {
    const targetHeight = pendingAppendHeightRef.current;
    const state = listRef.current?.getState();
    if (
      targetHeight !== null &&
      state &&
      !userScrollingRef.current &&
      Math.abs(state.scrollLength - targetHeight) <= 1
    ) {
      pendingAppendHeightRef.current = null;
      void listRef.current?.scrollToEnd({ animated: false });
    }
  }, []);
  const onContentSizeChange = useCallback(
    (nextHeight: number) => {
      const previous = previousContent.current;
      const detailsChanged = previous.expandedRows !== props.expandedRows;
      const followAppend =
        loadedRef.current &&
        shouldFollowThreadWorkGroupAppend({
          previousRows: previous.rows,
          rows: props.activities,
          previousContentHeight: previous.height,
          contentHeight: nextHeight,
          viewportHeight: Math.min(previous.height, WORK_GROUP_MAX_HEIGHT),
          scrollOffset: scrollOffset.value,
          detailsChanged,
          userScrolling: userScrollingRef.current,
        });
      previousContent.current = {
        rows: props.activities,
        height: nextHeight,
        expandedRows: props.expandedRows,
      };
      setMeasuredContent((current) =>
        current.height === nextHeight && current.rowCount === props.activities.length
          ? current
          : { height: nextHeight, rowCount: props.activities.length },
      );
      // Follow new calls only, never a detail toggle or a growing tool result.
      if (followAppend) {
        pendingAppendHeightRef.current = Math.min(nextHeight, WORK_GROUP_MAX_HEIGHT);
      } else if (detailsChanged || userScrollingRef.current || previous.rows !== props.activities) {
        pendingAppendHeightRef.current = null;
      } else if (pendingAppendHeightRef.current !== null) {
        pendingAppendHeightRef.current = Math.min(nextHeight, WORK_GROUP_MAX_HEIGHT);
      }
      // A short group can grow its viewport on this append. Wait for that
      // layout before calculating the end offset, rather than jumping twice.
      finishPendingAppend();
      rememberPosition();
    },
    [props.activities, props.expandedRows, scrollOffset, finishPendingAppend, rememberPosition],
  );
  // The native ScrollView reports its content size a frame or more after
  // LegendList has laid the rows out, so a detail toggle rendered the group
  // at its old height while the rows below already moved. Read the size
  // LegendList computes on the JS thread instead; it settles in the same
  // commit as the row measurement that changed it.
  const onContentSizeChangeRef = useRef(onContentSizeChange);
  useLayoutEffect(() => {
    onContentSizeChangeRef.current = onContentSizeChange;
  }, [onContentSizeChange]);
  const subscribeToContentSize = useCallback((list: LegendListRef | null) => {
    listRef.current = list;
    if (!list) return;
    const unsubscribe = list.getState().listen("totalSize", () => {
      onContentSizeChangeRef.current(list.getState().contentLength);
    });
    onContentSizeChangeRef.current(list.getState().contentLength);
    return unsubscribe;
  }, []);
  const getFixedItemSize = useCallback(
    (row: ThreadFeedActivity, index: number) =>
      props.expandedRows[row.id] || props.rowSizing.fixedRowHeight === undefined
        ? undefined
        : props.rowSizing.fixedRowHeight + (index < props.activities.length - 1 ? WORK_ROW_GAP : 0),
    [props.activities.length, props.expandedRows, props.rowSizing.fixedRowHeight],
  );
  const { renderRow } = props;
  const renderItem = useCallback(
    ({ item, index }: { item: ThreadFeedActivity; index: number }) => renderRow(item, index),
    [renderRow],
  );

  return (
    <View style={{ height, overflow: "hidden" }}>
      <AnimatedLegendList
        ref={subscribeToContentSize}
        data={props.activities}
        keyExtractor={workLogRowKey}
        estimatedItemSize={props.rowSizing.estimatedRowHeight + WORK_ROW_GAP}
        getFixedItemSize={getFixedItemSize}
        initialScrollIndex={initialScrollIndex}
        // Bootstrap overscan is only 50px. An offset inside expanded detail can
        // otherwise leave its own row unmeasured until after scroll restoration.
        alwaysRender={
          restoringPosition && initialPosition ? { keys: [initialPosition.rowId] } : undefined
        }
        recycleItems={false}
        extraData={props.renderRow}
        renderItem={renderItem}
        sharedValues={sharedValues}
        onLayout={finishPendingAppend}
        onLoad={() => {
          loadedRef.current = true;
          setRestoringPosition(false);
          rememberPosition();
        }}
        onScroll={rememberPosition}
        onScrollBeginDrag={() => {
          userScrollingRef.current = true;
          pendingAppendHeightRef.current = null;
        }}
        onScrollEndDrag={() => {
          userScrollingRef.current = false;
        }}
        onMomentumScrollBegin={() => {
          userScrollingRef.current = true;
          pendingAppendHeightRef.current = null;
        }}
        onMomentumScrollEnd={() => {
          userScrollingRef.current = false;
          rememberPosition();
        }}
        maintainVisibleContentPosition
        nestedScrollEnabled
        directionalLockEnabled
        showsVerticalScrollIndicator
        scrollsToTop={false}
        bounces={false}
        keyboardShouldPersistTaps="handled"
        style={{ height }}
      />
      <Animated.View
        pointerEvents="none"
        className="absolute inset-x-0 top-0"
        style={[{ height: WORK_GROUP_EDGE_FADE_HEIGHT }, topFadeStyle]}
      >
        <EdgeFade color={props.edgeFadeColor} direction="down" />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        className="absolute inset-x-0 bottom-0"
        style={[{ height: WORK_GROUP_EDGE_FADE_HEIGHT }, bottomFadeStyle]}
      >
        <EdgeFade color={props.edgeFadeColor} direction="up" />
      </Animated.View>
    </View>
  );
}

/** A screen-colored gradient painted over the list edge that still has content past it. */
function EdgeFade(props: { readonly color: string; readonly direction: "up" | "down" }) {
  const gradientId = `work-group-fade-${useId().replaceAll(":", "")}`;
  return (
    <Svg width="100%" height="100%">
      <Defs>
        <LinearGradient id={gradientId} x1="0%" x2="0%" y1="0%" y2="100%">
          <Stop
            offset={0}
            stopColor={props.color}
            stopOpacity={props.direction === "down" ? 1 : 0}
          />
          <Stop
            offset={1}
            stopColor={props.color}
            stopOpacity={props.direction === "down" ? 0 : 1}
          />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

function workLogRowKey(row: ThreadFeedActivity): string {
  return row.id;
}

/** "+48 −12" for a file change, coloured like the other mobile diff counts; the signs carry the meaning. */
function WorkLogDiffStat(props: { readonly stat: WorkLogDiffStatValue }) {
  const { additions, deletions } = props.stat;
  return (
    <View
      className="flex-row items-center gap-1 pr-1"
      accessible
      accessibilityLabel={`${additions} additions, ${deletions} deletions`}
    >
      <Text className="text-2xs tabular-nums text-diff-addition">+{additions}</Text>
      <Text className="text-2xs tabular-nums text-diff-deletion">−{deletions}</Text>
    </View>
  );
}

/**
 * A step's dot on the thinking timeline, holding the step's icon so it reads
 * without colour. The running step gets a static, thicker primary-edge ring, never
 * an animation. The dot is opaque so the rail stops at its edge; while the row
 * is pressed it repeats the row's `bg-subtle` tint so the two still match.
 */
function ThreadTimelineMarker(props: {
  readonly enabled: boolean;
  readonly running: boolean;
  readonly pressed: boolean;
  readonly children: ReactNode;
}) {
  if (!props.enabled) return props.children;
  return (
    <View
      className={cn(
        "h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-screen",
        props.running ? "border-2 border-primary-edge" : "border border-border",
      )}
    >
      {props.pressed ? <View className="absolute inset-0 bg-subtle" /> : null}
      {props.children}
    </View>
  );
}

/** A static stretch of the timeline rail, centred on the dot column. */
function ThreadTimelineRailLine(props: {
  readonly className: string;
  readonly style: { readonly top?: number; readonly bottom?: number; readonly height?: number };
}) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn("absolute w-6 items-center", props.className)}
      style={props.style}
    >
      <View className="w-px flex-1 bg-border" />
    </View>
  );
}

/**
 * One row's piece of the timeline rail, drawn behind the row's dot. Every
 * timeline dot sits in a band `rowHeight` tall at the top of its row, so the
 * first piece starts at that dot, the last ends there (above any opened
 * body), and the others run the full row plus `trailingGap` to meet the next.
 */
function ThreadTimelineRail(props: {
  readonly step: ThreadTimelineStep;
  readonly rowHeight: number;
  readonly trailingGap: number;
  /** Left offset that lines the rail up with the row's dot column. */
  readonly className: string;
}) {
  const half = props.rowHeight / 2;
  const startsAtDot = props.step === "first" || props.step === "only";
  const endsAtDot = props.step === "last" || props.step === "only";
  if (startsAtDot && endsAtDot) return null;
  return (
    <ThreadTimelineRailLine
      className={props.className}
      style={
        endsAtDot
          ? { top: 0, height: half }
          : { top: startsAtDot ? half : 0, bottom: -props.trailingGap }
      }
    />
  );
}

/** Settled-step meta at the right of a timeline row: "1.2s", "Thought for 3s". */
function ThreadTimelineMetaText(props: { readonly children: string }) {
  return (
    <Text className="pr-1 text-2xs tabular-nums text-foreground-muted" numberOfLines={1}>
      {props.children}
    </Text>
  );
}

const ThreadWorkLogRow = memo(function ThreadWorkLogRow(
  props: Omit<
    ThreadWorkLogProps,
    | "activities"
    | "copiedRowId"
    | "edgeFadeColor"
    | "expandedRows"
    | "rowSizing"
    | "scrollPositions"
    | "timelineStep"
  > & {
    readonly row: ThreadFeedActivity;
    readonly copied: boolean;
    readonly expanded: boolean;
    readonly timeline: boolean;
    /** The dot band height; a timeline dot stays in it when the label wraps. */
    readonly rowHeight: number;
  },
) {
  const { row, expanded, timeline } = props;
  const running = timeline && row.runningStep === true;
  const { meta: stepMeta, inlineDiffStat } = workEntryRowStats(row.workEntry, timeline);
  const canExpand = row.canExpand;
  // Tool calls show the call in the foreground and the result muted below it.
  const expandedParts = expanded ? row.getExpandedParts() : null;
  const viewedImagePath = workEntryViewedImagePath(row.workEntry);
  const toolPresentation = resolveWorkEntryToolPresentation(row.workEntry);
  const previewText = workEntryRowLabel(row.workEntry);
  const answerPreview = row.workEntry.questionAnswer
    ? getQuestionAnswerPreview(row.workEntry.questionAnswer)
    : null;
  const accessiblePreview = [previewText, answerPreview].filter(Boolean).join(": ");
  const displayText = workEntryRowLabel(row.workEntry, expanded);
  const iconIsDestructive = row.icon === "alert" || row.icon === "warning";
  const failed = row.status === "failure";
  const toolIcon = row.workEntry.toolIcon ?? row.workEntry.toolSource?.icon;
  const icon = toolPresentation?.icon ?? workRowSymbolName(row.icon);
  const taskList = row.workEntry.taskList;

  return (
    <Animated.View
      layout={WORK_LOG_LAYOUT_TRANSITION}
      className="overflow-hidden"
      {...(isFreshRow(row.createdAt) ? { entering: FadeIn.duration(200) } : {})}
    >
      <Pressable
        accessibilityRole={canExpand ? "button" : undefined}
        accessibilityLabel={
          failed
            ? `${accessiblePreview}, tool call failed`
            : running
              ? `${accessiblePreview}, running`
              : accessiblePreview
        }
        accessibilityHint={
          canExpand
            ? `Double tap to ${expanded ? "hide" : "show"} full details. Long press to copy.`
            : "Long press to copy."
        }
        accessibilityState={canExpand ? { expanded } : undefined}
        hitSlop={taskList ? 6 : 4}
        onPress={() => {
          if (canExpand) {
            void Haptics.selectionAsync();
            props.onToggleRow(row.id, props.anchorKey);
          }
        }}
        onLongPress={() => props.onCopyRow(row.id, row.getCopyText())}
        className="rounded-md px-0.5 py-0 active:bg-subtle"
      >
        {({ pressed }) => (
          <View className="min-h-8 flex-row items-center gap-1.5">
            {/* On the timeline the ringed dot marks the running step; the group header reads live in primary text. */}
            {row.live && !expanded && !timeline ? (
              <LiveWorkContent
                environmentId={props.environmentId}
                icon={icon}
                iconSubtleColor={props.iconSubtleColor}
                label={displayText}
                showIcon
                themeAppearance={props.themeAppearance}
                toolIcon={toolIcon}
              />
            ) : (
              <>
                {/* A timeline dot keeps to the first line's band so the rail can meet it there. */}
                <View
                  className={cn(
                    "w-6 shrink-0 items-center justify-center",
                    timeline ? "self-start" : "h-6",
                  )}
                  style={timeline ? { height: props.rowHeight } : undefined}
                >
                  <ThreadTimelineMarker enabled={timeline} running={running} pressed={pressed}>
                    {toolIcon ? (
                      <ToolActivityIconView
                        environmentId={props.environmentId}
                        icon={toolIcon}
                        fallback={icon}
                        fallbackColor={props.iconSubtleColor}
                        themeAppearance={props.themeAppearance}
                      />
                    ) : (
                      <WorkLogIcon
                        icon={icon}
                        color={props.iconSubtleColor}
                        colorClassName={
                          iconIsDestructive
                            ? "accent-adaptive-rose-600-400"
                            : failed
                              ? "accent-danger-foreground/40"
                              : undefined
                        }
                      />
                    )}
                  </ThreadTimelineMarker>
                </View>
                <Text
                  className={cn(
                    "min-w-0 flex-1 text-sm text-foreground-muted",
                    iconIsDestructive && "font-e6-medium text-adaptive-rose-600-400",
                  )}
                  numberOfLines={expanded ? undefined : 1}
                >
                  {displayText}
                  {answerPreview ? (
                    <Text
                      className={
                        !expanded &&
                        row.workEntry.questionAnswer &&
                        hasQuestionAnswer(row.workEntry.questionAnswer)
                          ? "text-foreground"
                          : "text-foreground-subtle"
                      }
                    >{`  ${answerPreview}`}</Text>
                  ) : null}
                </Text>
              </>
            )}

            <View className="shrink-0 flex-row items-center gap-px">
              {inlineDiffStat && !(row.live && !expanded) ? (
                <WorkLogDiffStat stat={inlineDiffStat} />
              ) : null}
              {stepMeta ? (
                <View className="flex-row items-center gap-1">
                  {stepMeta.diffStat ? <WorkLogDiffStat stat={stepMeta.diffStat} /> : null}
                  {stepMeta.duration ? (
                    <ThreadTimelineMetaText>{stepMeta.duration}</ThreadTimelineMetaText>
                  ) : null}
                </View>
              ) : null}
              {props.copied ? (
                <Text className="pr-1 font-e6-medium text-3xs text-adaptive-emerald-600-400">
                  Copied
                </Text>
              ) : null}
              {failed && toolIcon !== undefined ? (
                <View
                  className="h-4 w-4 items-center justify-center"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  <SymbolView
                    name="xmark"
                    size={11}
                    tintColorClassName="accent-danger-foreground/40"
                    type="monochrome"
                  />
                </View>
              ) : null}
              <View className="h-4 w-4 items-center justify-center">
                {canExpand ? (
                  <ThreadDisclosureChevron
                    expanded={expanded}
                    collapsedDirection="down"
                    size={11}
                    tintColor={props.iconSubtleColor}
                  />
                ) : null}
              </View>
            </View>
          </View>
        )}
      </Pressable>

      {expanded && (expandedParts || viewedImagePath || row.workEntry.questionAnswer) ? (
        <Animated.View
          entering={WORK_LOG_DETAIL_ENTER_TRANSITION}
          exiting={WORK_LOG_DETAIL_EXIT_TRANSITION}
          layout={WORK_LOG_LAYOUT_TRANSITION}
          className="ml-7 pb-1 pl-3 pt-0.5"
        >
          {row.workEntry.questionAnswer ? (
            <QuestionAnswerHistory
              environmentId={props.environmentId}
              answer={row.workEntry.questionAnswer}
            />
          ) : null}
          {viewedImagePath ? (
            <View className="pb-1.5">
              {props.renderImage({ href: viewedImagePath, alt: null, title: null })}
            </View>
          ) : null}
          {taskList ? (
            <TaskListSteps steps={taskList} />
          ) : (
            <ScrollView
              nestedScrollEnabled
              directionalLockEnabled
              showsVerticalScrollIndicator
              className="max-h-60"
              contentContainerStyle={{ paddingRight: 8 }}
            >
              {expandedParts?.call ? (
                <Text selectable className="font-mono text-2xs leading-normal text-foreground">
                  {expandedParts.call}
                </Text>
              ) : null}
              {expandedParts?.result ? (
                <Text
                  selectable
                  className={cn(
                    "font-mono text-2xs leading-normal text-foreground-muted",
                    expandedParts.call && "mt-1.5",
                  )}
                >
                  {expandedParts.result}
                </Text>
              ) : null}
            </ScrollView>
          )}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
});

const TASK_LIST_STEP_SYMBOLS = {
  completed: "checkmark.circle",
  inProgress: "arrow.right.circle",
  pending: "circle",
} as const satisfies Record<TaskListStepStatus, AppSymbolName>;

/** A task list's steps, each with its status as an icon and a word. Only the live step uses primary. */
export function TaskListSteps(props: { readonly steps: ReadonlyArray<TaskListStep> }) {
  // Steps have no id and their text may repeat, so key by text and occurrence.
  const occurrences = new Map<string, number>();
  return (
    <View className="gap-1 pb-0.5">
      {props.steps.map((step) => {
        const occurrence = occurrences.get(step.step) ?? 0;
        occurrences.set(step.step, occurrence + 1);
        const live = step.status === "inProgress";
        const statusLabel = TASK_LIST_STEP_STATUS_LABELS[step.status];
        return (
          <View
            key={`${step.step}:${occurrence}`}
            accessible
            accessibilityLabel={`${statusLabel}: ${step.step}`}
            className="flex-row items-start gap-2"
          >
            <View className="h-5 w-4 items-center justify-center">
              <SymbolView
                name={TASK_LIST_STEP_SYMBOLS[step.status]}
                size={13}
                weight="medium"
                tintColorClassName={live ? "accent-primary-text" : "accent-icon-subtle"}
                type="monochrome"
              />
            </View>
            <Text
              selectable
              className={cn(
                "min-w-0 flex-1 text-xs leading-5",
                live ? "font-e6-medium text-foreground" : "text-foreground-muted",
              )}
            >
              {step.step}
              <Text
                className={cn("text-2xs", live ? "text-primary-text" : "text-foreground-subtle")}
              >{`  ${statusLabel}`}</Text>
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function ThreadWorkGroupToggle(props: {
  readonly environmentId: EnvironmentId;
  readonly rowSizing: ReturnType<typeof deriveThreadWorkLogSizing>;
  readonly expanded: boolean;
  readonly hiddenCount: number;
  readonly iconSubtleColor: import("react-native").ColorValue;
  readonly summary: string;
  readonly summaryKind: ToolGroupSummaryKind;
  readonly summaryToolIcon?: "browser" | "device" | "e6-code" | "pull-request" | "brain";
  readonly themeAppearance: "light" | "dark";
  readonly toolSurface?: import("@e6tools/contracts").ToolActivitySurface;
  readonly toolIcon?: ToolActivityIcon;
  readonly hasFailure: boolean;
  readonly shimmer: boolean;
  readonly onToggle: () => void;
}) {
  const accessibilityLabel = props.hasFailure
    ? `${props.summary}, tool call failed`
    : props.summary;
  const icon =
    props.summaryToolIcon ??
    (props.toolSurface
      ? workRowSymbolName(props.toolSurface)
      : toolGroupSummarySymbolName(props.summaryKind));

  return (
    <View className="-mx-1 px-1 py-0">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: props.expanded }}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={`Double tap to ${props.expanded ? "hide" : "show"} ${props.hiddenCount} tool ${props.hiddenCount === 1 ? "call" : "calls"}.`}
        hitSlop={4}
        onPress={() => {
          void Haptics.selectionAsync();
          props.onToggle();
        }}
        className="min-h-8 flex-row items-center gap-1.5 rounded-md px-0.5 py-0 active:bg-subtle"
        style={{ minHeight: props.rowSizing.estimatedRowHeight }}
      >
        {props.shimmer ? (
          <LiveWorkContent
            key={props.rowSizing.textSizeKey}
            environmentId={props.environmentId}
            icon={icon}
            iconSubtleColor={props.iconSubtleColor}
            label={props.summary}
            showIcon
            themeAppearance={props.themeAppearance}
            toolIcon={props.toolIcon}
          />
        ) : (
          <>
            <View className="h-6 w-6 items-center justify-center">
              <ToolActivityIconView
                environmentId={props.environmentId}
                icon={props.toolIcon}
                fallback={icon}
                fallbackColor={props.iconSubtleColor}
                themeAppearance={props.themeAppearance}
              />
            </View>
            <Text
              key={props.rowSizing.textSizeKey}
              className="min-w-0 flex-1 text-sm text-foreground-muted"
              numberOfLines={1}
            >
              {props.summary}
            </Text>
          </>
        )}
        <ThreadDisclosureChevron
          expanded={props.expanded}
          collapsedDirection="down"
          size={11}
          tintColor={props.iconSubtleColor}
        />
      </Pressable>
    </View>
  );
}

/**
 * Pending requests by the subagent that made them. The thread screen provides
 * them; a spawn card shows those members as blocked, with what they want.
 */
export const SubagentRequestsContext = createContext<ReadonlyMap<string, SubagentUserRequest>>(
  new Map(),
);

type AgentSpawnCardTone = AgentSpawnSummary["tone"] | "approval" | "question";

function isWaitingTone(tone: AgentSpawnCardTone): boolean {
  return tone === "approval" || tone === "question";
}

// Working takes Iris (primary), as on web; each dot sits beside its word.
const AGENT_SPAWN_TONE_DOT_CLASS = {
  approval: "bg-warning-foreground",
  question: "bg-warning-foreground",
  working: "bg-primary-text",
  completed: "bg-success-foreground",
  failed: "bg-danger-foreground",
  stopped: "bg-foreground-muted",
} as const satisfies Record<AgentSpawnCardTone, string>;

const AGENT_SPAWN_TONE_TEXT_CLASS = {
  approval: "text-warning-foreground",
  question: "text-warning-foreground",
  working: "text-primary-text",
  completed: "text-success-foreground",
  failed: "text-danger-foreground",
  stopped: "text-foreground-muted",
} as const satisfies Record<AgentSpawnCardTone, string>;

const AGENT_SPAWN_TONE_WORD = {
  approval: "Needs approval",
  question: "Needs your answer",
  working: "Working",
  completed: "Done",
  failed: "Failed",
  stopped: "Stopped",
} as const satisfies Record<AgentSpawnCardTone, string>;

const AGENT_SPAWN_SUMMARY_ORDER = [
  "approval",
  "question",
  "working",
  "failed",
  "stopped",
  "completed",
] as const;
const AGENT_SPAWN_COUNT_WORD = {
  approval: "needs approval",
  question: "needs your answer",
  working: "working",
  failed: "failed",
  stopped: "stopped",
  completed: "done",
} as const satisfies Record<AgentSpawnCardTone, string>;

function agentSpawnCount(tone: AgentSpawnCardTone, count: number): string {
  const needs = count === 1 ? "needs" : "need";
  if (tone === "approval") return `${count} ${needs} approval`;
  if (tone === "question") return `${count} ${needs} your answer`;
  return `${count} ${AGENT_SPAWN_COUNT_WORD[tone]}`;
}

/**
 * "3 working · 1 done": live work first, then problems, then successes. When
 * the batch's own state disagrees with its members (a coordinator still
 * running between launches, or one that failed after its members finished),
 * that state leads, so the line's color and its first word always agree.
 */
function agentSpawnCountsText(
  members: ReadonlyArray<{ readonly tone: AgentSpawnCardTone }>,
  batchTone: AgentSpawnSummary["tone"],
): string {
  const counts = AGENT_SPAWN_SUMMARY_ORDER.flatMap((tone) => {
    const count = members.filter((member) => member.tone === tone).length;
    if (count === 0) return [];
    return [agentSpawnCount(tone, count)];
  });
  // A blocked member is still live work, so it satisfies a working batch.
  const leads = members.some(
    (member) =>
      member.tone === batchTone || (batchTone === "working" && isWaitingTone(member.tone)),
  );
  const lead =
    batchTone === "completed" || leads
      ? []
      : [batchTone === "working" ? "Working" : batchTone === "failed" ? "Failed" : "Stopped"];
  return [...lead, ...counts].join(" · ");
}

/** Status word with its dot; the word carries the state, the dot only echoes it. */
function AgentSpawnStatusWord(props: { readonly tone: AgentSpawnCardTone }) {
  return (
    <View className="shrink-0 flex-row items-center gap-1.5">
      <View className={cn("h-1.5 w-1.5 rounded-full", AGENT_SPAWN_TONE_DOT_CLASS[props.tone])} />
      <Text className={cn("font-e6-medium text-xs", AGENT_SPAWN_TONE_TEXT_CLASS[props.tone])}>
        {AGENT_SPAWN_TONE_WORD[props.tone]}
      </Text>
    </View>
  );
}

/** A raised tile standing in for one subagent in the stack and the rows. */
function AgentSpawnTile(props: {
  readonly size: "stack" | "row";
  readonly iconSubtleColor: ColorValue;
  readonly label?: string;
  readonly stacked?: boolean;
}) {
  const row = props.size === "row";
  return (
    <View
      className={cn(
        "shrink-0 items-center justify-center rounded-lg border border-border bg-subtle",
        row ? "h-7 w-7" : "h-6 w-6",
        props.stacked && "-ml-2 border-2 border-card",
      )}
    >
      {props.label ? (
        <Text className="font-e6-bold text-2xs text-foreground">{props.label}</Text>
      ) : (
        <SymbolView
          name={{ ios: "sparkles", android: "auto_awesome" }}
          size={row ? 13 : 11}
          weight="medium"
          tintColor={props.iconSubtleColor}
          type="monochrome"
        />
      )}
    </View>
  );
}

/**
 * A batch of spawned subagents. The header counts members by status; expanding
 * lists each one with its status word and latest activity. Text nodes carry
 * keys tied to the row identity only, so a progress tick re-renders the labels
 * without remounting the card (see the batch key in appendActivityGroupRows).
 */
export const ThreadAgentSpawnCard = memo(function ThreadAgentSpawnCard(props: {
  readonly summary: AgentSpawnSummary;
  readonly expanded: boolean;
  readonly iconSubtleColor: ColorValue;
  readonly rowSizing: ReturnType<typeof deriveThreadWorkLogSizing>;
  readonly onToggle: () => void;
  readonly onCopy: () => void;
}) {
  const { summary, expanded } = props;
  const subagentRequests = use(SubagentRequestsContext);
  // A member blocked on the user says so, and what it wants; rows keep spawn order.
  const members = summary.members.map((member) => {
    const request = member.tone === "working" ? subagentRequests.get(member.id) : undefined;
    if (!request) return member;
    const { text, code } = describeSubagentUserRequest(request);
    return {
      ...member,
      tone: request.kind === "approval" ? ("approval" as const) : ("question" as const),
      detail: code ? `${text} ${code}` : text,
    };
  });
  const memberCount = members.length;
  const canExpand = memberCount > 0;
  // Approval outranks a question, as in the counts line.
  const waitingTone = members.some((member) => member.tone === "approval")
    ? ("approval" as const)
    : members.some((member) => member.tone === "question")
      ? ("question" as const)
      : null;
  const headerTone: AgentSpawnCardTone =
    summary.tone === "working" && waitingTone ? waitingTone : summary.tone;
  const statusText =
    memberCount > 1
      ? agentSpawnCountsText(members, summary.tone)
      : isWaitingTone(headerTone)
        ? AGENT_SPAWN_TONE_WORD[headerTone]
        : summary.status;
  const stackTiles = Math.min(Math.max(memberCount, 1), memberCount > 4 ? 3 : 4);
  return (
    <Animated.View layout={WORK_LOG_LAYOUT_TRANSITION} className="-mx-1 mb-1 px-1">
      <View className="overflow-hidden rounded-2xl border border-border-subtle bg-card">
        <Pressable
          accessibilityRole={canExpand ? "button" : undefined}
          accessibilityState={canExpand ? { expanded } : undefined}
          accessibilityLabel={`${summary.title}, ${statusText}`}
          accessibilityHint={
            canExpand
              ? `Double tap to ${expanded ? "hide" : "show"} ${memberCount} ${memberCount === 1 ? "subagent" : "subagents"}. Long press to copy.`
              : "Long press to copy."
          }
          hitSlop={4}
          onPress={() => {
            if (!canExpand) return;
            void Haptics.selectionAsync();
            props.onToggle();
          }}
          onLongPress={props.onCopy}
          className="min-h-[60px] flex-row items-center gap-3 px-3.5 py-2.5 active:bg-subtle"
        >
          <View className="flex-row pl-2">
            {Array.from({ length: stackTiles }, (_, index) => (
              <AgentSpawnTile
                key={index}
                size="stack"
                stacked
                iconSubtleColor={props.iconSubtleColor}
              />
            ))}
            {memberCount > stackTiles ? (
              <AgentSpawnTile
                size="stack"
                stacked
                iconSubtleColor={props.iconSubtleColor}
                label={`+${memberCount - stackTiles}`}
              />
            ) : null}
          </View>
          <View className="min-w-0 flex-1 gap-0.5">
            <Text
              key={props.rowSizing.textSizeKey}
              className="font-e6-semibold text-base text-foreground"
              numberOfLines={1}
            >
              {summary.title}
            </Text>
            <View className="flex-row items-center gap-1.5">
              <View
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  AGENT_SPAWN_TONE_DOT_CLASS[headerTone],
                )}
              />
              <Text
                className={cn(
                  "min-w-0 flex-1 font-e6-medium text-sm",
                  AGENT_SPAWN_TONE_TEXT_CLASS[headerTone],
                )}
                numberOfLines={1}
              >
                {statusText}
              </Text>
            </View>
          </View>
          {canExpand ? (
            <ThreadDisclosureChevron
              expanded={expanded}
              collapsedDirection="down"
              size={11}
              tintColor={props.iconSubtleColor}
            />
          ) : null}
        </Pressable>
        {expanded && canExpand ? (
          <Animated.View
            entering={WORK_LOG_DETAIL_ENTER_TRANSITION}
            exiting={WORK_LOG_DETAIL_EXIT_TRANSITION}
            layout={WORK_LOG_LAYOUT_TRANSITION}
            className="border-t border-border-subtle p-1"
          >
            {members.map((member) => (
              <View key={member.id} className="flex-row items-start gap-3 rounded-xl p-2.5">
                <AgentSpawnTile size="row" iconSubtleColor={props.iconSubtleColor} />
                <View className="min-w-0 flex-1 gap-px">
                  <View className="flex-row items-center gap-2">
                    <Text
                      className="min-w-0 flex-1 font-e6-medium text-sm text-foreground"
                      numberOfLines={1}
                    >
                      {member.title}
                    </Text>
                    <AgentSpawnStatusWord tone={member.tone} />
                  </View>
                  {member.detail ? (
                    <Text
                      selectable
                      className="font-mono text-xs leading-normal text-foreground-muted"
                      numberOfLines={2}
                    >
                      {member.detail}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </Animated.View>
        ) : null}
      </View>
    </Animated.View>
  );
});

export function ThreadThinkingRow(props: {
  readonly rowSizing: ReturnType<typeof deriveThreadWorkLogSizing>;
  readonly iconSubtleColor: ColorValue;
}) {
  return (
    <View
      accessible
      accessibilityLabel="Thinking"
      className="-mx-1 min-h-8 flex-row items-center px-1.5 py-0"
      style={{ minHeight: props.rowSizing.estimatedRowHeight }}
    >
      <LiveWorkContent
        key={props.rowSizing.textSizeKey}
        icon="brain"
        iconSubtleColor={props.iconSubtleColor}
        label="Thinking"
        showIcon
      />
    </View>
  );
}

/**
 * A provider's thinking trace. Collapsed by default: reasoning is context for
 * the answer, not the answer. `expanded` lives on the feed so it survives row
 * recycling; `children` is the trace body and only mounts while open.
 */
export function ThreadReasoningRow(props: {
  readonly rowSizing: ReturnType<typeof deriveThreadWorkLogSizing>;
  readonly iconSubtleColor: ColorValue;
  readonly expanded: boolean;
  readonly label: string;
  readonly streaming: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
  /** The thought's place on the thinking timeline; set only when the setting is on. */
  readonly timelineStep?: ThreadTimelineStep;
  /** On the timeline, a collapsed thought shows this preview and its duration on the right. */
  readonly preview?: string | null;
}) {
  const timeline = props.timelineStep !== undefined;
  const collapsedPreview =
    timeline && !props.expanded && !props.streaming && props.preview ? props.preview : null;
  return (
    <View className={cn("-mx-1 px-1 py-0", props.expanded && "pb-1.5")}>
      {props.timelineStep ? (
        <ThreadTimelineRail
          step={props.timelineStep}
          rowHeight={props.rowSizing.estimatedRowHeight}
          trailingGap={0}
          className="left-1.5"
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: props.expanded }}
        accessibilityLabel={props.label}
        accessibilityHint={`Double tap to ${props.expanded ? "hide" : "show"} the thinking trace.`}
        hitSlop={4}
        onPress={() => {
          void Haptics.selectionAsync();
          props.onToggle();
        }}
        className="min-h-8 flex-row items-center gap-1.5 rounded-md px-0.5 py-0 active:bg-subtle"
        style={{ minHeight: props.rowSizing.estimatedRowHeight }}
      >
        {({ pressed }) => (
          <>
            {props.streaming ? (
              <LiveWorkContent
                key={props.rowSizing.textSizeKey}
                icon="brain"
                iconSubtleColor={props.iconSubtleColor}
                label={props.label}
                showIcon
              />
            ) : (
              <>
                <View className="h-6 w-6 shrink-0 items-center justify-center">
                  <ThreadTimelineMarker enabled={timeline} running={false} pressed={pressed}>
                    <WorkLogIcon icon="brain" color={props.iconSubtleColor} />
                  </ThreadTimelineMarker>
                </View>
                <Text
                  key={props.rowSizing.textSizeKey}
                  className="min-w-0 flex-1 text-sm text-foreground-muted"
                  numberOfLines={1}
                >
                  {collapsedPreview ?? props.label}
                </Text>
                {collapsedPreview ? (
                  <ThreadTimelineMetaText>{props.label}</ThreadTimelineMetaText>
                ) : null}
              </>
            )}
            <ThreadDisclosureChevron
              expanded={props.expanded}
              collapsedDirection="right"
              size={11}
              tintColor={props.iconSubtleColor}
            />
          </>
        )}
      </Pressable>
      {props.expanded ? (
        <Animated.View
          entering={WORK_LOG_DETAIL_ENTER_TRANSITION}
          exiting={WORK_LOG_DETAIL_EXIT_TRANSITION}
          layout={WORK_LOG_LAYOUT_TRANSITION}
          className="ml-7 mt-1 rounded-xl bg-subtle px-3 py-2"
        >
          <ScrollView
            nestedScrollEnabled
            directionalLockEnabled
            showsVerticalScrollIndicator
            className="max-h-80"
          >
            {props.children}
          </ScrollView>
        </Animated.View>
      ) : null}
    </View>
  );
}

function ToolActivityIconView(props: {
  readonly environmentId: EnvironmentId;
  readonly icon?: ToolActivityIcon;
  readonly fallback: WorkContentIcon;
  readonly fallbackColor: ColorValue;
  readonly themeAppearance: "light" | "dark";
}) {
  if (!props.icon) {
    return <WorkLogIcon icon={props.fallback} color={props.fallbackColor} />;
  }
  if (props.icon._tag === "website") {
    const source = toolActivityFaviconUrl(props.icon, props.themeAppearance, 32);
    return source ? (
      <ToolActivityImage
        key={source}
        source={source}
        fallback={props.fallback}
        color={props.fallbackColor}
        themeAppearance={props.themeAppearance}
      />
    ) : (
      <WorkLogIcon icon={props.fallback} color={props.fallbackColor} />
    );
  }
  if (props.icon._tag === "themed-logo") {
    const source =
      props.themeAppearance === "dark"
        ? (props.icon.logoUrlDark ?? props.icon.logoUrl)
        : props.icon.logoUrl;
    return (
      <ToolActivityImage
        key={source}
        source={source}
        fallback={props.fallback}
        color={props.fallbackColor}
        themeAppearance={props.themeAppearance}
      />
    );
  }
  return (
    <NativeAppToolActivityIcon
      environmentId={props.environmentId}
      app={props.icon.app}
      fallback={props.fallback}
      color={props.fallbackColor}
      themeAppearance={props.themeAppearance}
    />
  );
}

function NativeAppToolActivityIcon(props: {
  readonly environmentId: EnvironmentId;
  readonly app: Extract<ToolActivityIcon, { readonly _tag: "native-app" }>["app"];
  readonly fallback: WorkContentIcon;
  readonly color: ColorValue;
  readonly themeAppearance: "light" | "dark";
}) {
  const source = useAssetUrl(props.environmentId, {
    _tag: "native-app-icon",
    app: props.app,
  });
  return source ? (
    <ToolActivityImage
      key={source}
      source={source}
      fallback={props.fallback}
      color={props.color}
      themeAppearance={props.themeAppearance}
    />
  ) : (
    <WorkLogIcon icon={props.fallback} color={props.color} />
  );
}

function ToolActivityImage(props: {
  readonly source: string;
  readonly fallback: WorkContentIcon;
  readonly color: ColorValue;
  readonly themeAppearance: "light" | "dark";
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <View className="h-4 w-4 items-center justify-center overflow-hidden rounded-[3px] bg-background">
      {!loaded || failed ? <WorkLogIcon icon={props.fallback} color={props.color} /> : null}
      {!failed ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            props.themeAppearance === "light" ? { filter: [{ brightness: 0.6 }] } : undefined,
          ]}
        >
          <Image
            source={props.source}
            cachePolicy="memory-disk"
            contentFit="contain"
            style={[StyleSheet.absoluteFill, { opacity: loaded ? 0.7 : 0 }]}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        </View>
      ) : null}
    </View>
  );
}

function toolGroupSummarySymbolName(kind: ToolGroupSummaryKind): AppSymbolName {
  switch (kind) {
    case "pull-request":
    case "link-pr":
    case "unlink-pr":
    case "list-prs":
      return "arrow.triangle.pull";
    case "read":
      return { ios: "eye", android: "visibility" };
    case "edit":
      return { ios: "square.and.pencil", android: "edit" };
    case "command":
      return { ios: "terminal", android: "terminal" };
    case "device":
      return { ios: "iphone", android: "smartphone" };
    case "browser":
    case "search":
      return { ios: "globe", android: "public" };
    case "code-search":
      return "magnifyingglass";
    case "other":
      return { ios: "wrench", android: "build" };
    case "agent-tool":
      return { ios: "sparkles", android: "auto_awesome" };
    case "tone-tool":
      return { ios: "bolt", android: "bolt" };
    case "dynamic-tool":
    case "update":
    case "mixed":
      return { ios: "hammer", android: "construction" };
  }
}
