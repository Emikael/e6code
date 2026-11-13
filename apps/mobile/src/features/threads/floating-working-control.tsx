import {
  agentStateLabelTicks,
  formatAgentStateLabel,
} from "@e6tools/client-runtime/state/agent-state";
import type { ThreadAgentState } from "@e6tools/contracts";
import { formatDuration } from "@e6tools/shared/orchestrationTiming";
import { GlassContainer, GlassView } from "expo-glass-effect";
import { memo, type ReactNode, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  Pressable,
  Text as SystemText,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { withUniwind } from "uniwind";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { ControlPill } from "../../components/ControlPill";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { DevicePreviewButton } from "../devices/device-preview-button";
import type { FloatingWorkingStatus, PlanMeter } from "./floating-working-status";
import { useMinuteClock } from "../../lib/useMinuteClock";
import { LiveWorkContent } from "./thread-work-log";
import { WorkingHaloDot } from "./thread-list-v2-items";
import { THREAD_LIST_V2_MONO_FONT as MONO_FONT } from "./thread-list-v2-row-appearance";

const CONTROL_HEIGHT = 38.5; // h-11 with the mobile 14px rem
// The collapsed composer capsule starts 6 below its overlay's top edge, so
// the pill sits at (gap - 6) above the overlay to leave the same gap to the
// capsule as the feed's end inset leaves between it and the last row.
const CONTROL_GAP = 8;
const COMPOSER_CAPSULE_INSET = 6;
const GLASS_MERGE_SPACING = 12;
const CONTROL_ENTERING = FadeIn.duration(180).reduceMotion(ReduceMotion.System);
const CONTROL_EXITING = FadeOut.duration(120).reduceMotion(ReduceMotion.System);
const CONTROL_TIMING = {
  duration: 240,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;
const CONTROL_SEPARATION = (16 + CONTROL_HEIGHT) / 2;
// Both rows share the same centered anchor, so the outgoing one clears fast and
// the incoming one waits for it to be mostly gone before it starts to show.
const LABEL_ENTERING = FadeIn.duration(160).delay(80).reduceMotion(ReduceMotion.System);
const LABEL_EXITING = FadeOut.duration(100).reduceMotion(ReduceMotion.System);

// Expo reapplies glass after native layout and window reattachment, when UIKit
// can otherwise leave the label visible but lose the material behind it.
const UniwindGlassView = withUniwind(GlassView, {
  style: { fromClassName: "className" },
});
const UniwindGlassContainer = withUniwind(GlassContainer, {
  style: { fromClassName: "className" },
});
const AnimatedGlassView = Animated.createAnimatedComponent(UniwindGlassView);

const CONTROL_OVERLAY_OFFSET = CONTROL_HEIGHT + CONTROL_GAP - COMPOSER_CAPSULE_INSET;
export const FLOATING_WORKING_CONTROL_COVERAGE = CONTROL_OVERLAY_OFFSET + CONTROL_GAP;

export function FloatingWorkingControl(props: {
  readonly colorScheme: "light" | "dark";
  readonly status: FloatingWorkingStatus | null;
  readonly devicePreview: { readonly count: number; readonly onPress: () => void } | null;
  readonly showScrollToEnd: boolean;
  readonly onScrollToEnd: () => void;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const [overlayWidth, setOverlayWidth] = useState(windowWidth);
  const deviceControlWidth = props.devicePreview !== null ? CONTROL_HEIGHT : 0;
  const hasCapsule = props.status !== null || props.devicePreview !== null;
  const labelWidth = Math.max(
    0,
    Math.min(overlayWidth, windowWidth) - CONTROL_HEIGHT - 16 - deviceControlWidth,
  );
  const separationProgress = useSharedValue(props.showScrollToEnd ? 1 : 0);

  useEffect(() => {
    separationProgress.value = withTiming(props.showScrollToEnd ? 1 : 0, CONTROL_TIMING);
  }, [props.showScrollToEnd, separationProgress]);

  const arrowTransformStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -CONTROL_SEPARATION * (1 - separationProgress.value) }],
  }));
  const arrowContentStyle = useAnimatedStyle(() => ({
    opacity: separationProgress.value,
  }));

  // Animate an in-flow sizer so native glass receives real layout updates.
  // Measure labels in a separate, fixed-width host: measuring against the
  // animated capsule constrains the incoming text to each intermediate width
  // and repeatedly retargets the animation as it grows.
  const capsuleWidth = useSharedValue<number | null>(null);
  const measuredWidthRef = useRef<number | null>(null);
  const handleLabelLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width === measuredWidthRef.current) {
      return;
    }
    const first = measuredWidthRef.current === null;
    measuredWidthRef.current = width;
    capsuleWidth.value = first ? width : withTiming(width, CONTROL_TIMING);
  };
  // Forget the width while no label is shown so the next one appears at its
  // own size instead of animating from the previous label's.
  const hasStatus = props.status !== null;
  useEffect(() => {
    if (!hasStatus) {
      measuredWidthRef.current = null;
      capsuleWidth.value = null;
    }
  }, [capsuleWidth, hasStatus]);
  const capsuleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: CONTROL_SEPARATION * (1 - separationProgress.value) }],
  }));
  // Zero until the first measurement lands, so the capsule never paints around
  // a label it has not sized to yet.
  const capsuleSizerStyle = useAnimatedStyle(() => ({
    width: (capsuleWidth.value ?? 0) + deviceControlWidth,
  }));

  if (!hasCapsule && !props.showScrollToEnd) {
    return null;
  }

  // Connection and attention labels act as buttons (reconnect or scroll to turn).
  const statusInteractive =
    props.status?.kind === "connection" ||
    props.status?.kind === "attention" ||
    (props.status?.kind === "working" && props.status.onPress !== undefined);
  const capsuleInteractive = statusInteractive || props.devicePreview !== null;
  // The host stays centered on the capsule, but its measurement constraint
  // comes from the overlay, independent of the capsule's current width.
  const capsuleContent =
    props.status === null && props.devicePreview !== null ? (
      <DevicePreviewButton {...props.devicePreview} compact={false} />
    ) : props.status !== null ? (
      <>
        <Animated.View className="h-11" style={capsuleSizerStyle} />
        <View
          pointerEvents={statusInteractive ? "box-none" : "none"}
          className="absolute h-11 items-center justify-center"
          style={{ width: labelWidth, transform: [{ translateX: -deviceControlWidth / 2 }] }}
        >
          <FloatingStatusLabel
            key={
              props.status.kind === "working" || props.status.kind === "compacting"
                ? props.status.kind
                : props.status.kind === "agent-state"
                  ? `agent-state:${props.status.agentState.kind}`
                  : `${props.status.kind}:${props.status.label}`
            }
            status={props.status}
            onLayout={handleLabelLayout}
          />
        </View>
        {props.devicePreview !== null ? (
          <>
            <View
              pointerEvents="none"
              className="absolute h-4 w-px bg-border"
              style={{ right: deviceControlWidth }}
            />
            <View className="absolute right-0">
              <DevicePreviewButton {...props.devicePreview} />
            </View>
          </>
        ) : null}
      </>
    ) : null;

  return (
    <Animated.View
      pointerEvents="box-none"
      className="absolute left-0 right-0 z-20 items-center"
      style={{ top: -CONTROL_OVERLAY_OFFSET }}
      onLayout={(event) => setOverlayWidth(event.nativeEvent.layout.width)}
      entering={NATIVE_LIQUID_GLASS_SUPPORTED ? undefined : CONTROL_ENTERING}
      exiting={NATIVE_LIQUID_GLASS_SUPPORTED ? undefined : CONTROL_EXITING}
    >
      {hasCapsule && NATIVE_LIQUID_GLASS_SUPPORTED ? (
        <UniwindGlassContainer
          spacing={GLASS_MERGE_SPACING}
          pointerEvents="box-none"
          className="flex-row items-center gap-4"
        >
          <AnimatedGlassView
            colorScheme={props.colorScheme}
            glassEffectStyle="regular"
            isInteractive={capsuleInteractive}
            pointerEvents={capsuleInteractive ? "box-none" : "none"}
            className="h-11 items-center justify-center overflow-hidden rounded-full"
            style={capsuleStyle}
          >
            {capsuleContent}
          </AnimatedGlassView>

          <AnimatedGlassView
            colorScheme={props.colorScheme}
            glassEffectStyle="regular"
            isInteractive
            pointerEvents={props.showScrollToEnd ? "auto" : "none"}
            accessibilityElementsHidden={!props.showScrollToEnd}
            importantForAccessibility={props.showScrollToEnd ? "auto" : "no-hide-descendants"}
            className="h-11 w-11 items-center justify-center overflow-hidden rounded-full"
            style={arrowTransformStyle}
          >
            <Animated.View style={arrowContentStyle}>
              <ScrollToEndButton disabled={!props.showScrollToEnd} onPress={props.onScrollToEnd} />
            </Animated.View>
          </AnimatedGlassView>
        </UniwindGlassContainer>
      ) : hasCapsule ? (
        <View pointerEvents="box-none" className="flex-row items-center gap-4">
          <Animated.View
            pointerEvents={capsuleInteractive ? "box-none" : "none"}
            className="h-11 items-center justify-center overflow-hidden rounded-full border border-border bg-glass-fallback shadow-md shadow-black/10"
            style={capsuleStyle}
          >
            {capsuleContent}
          </Animated.View>

          <Animated.View
            pointerEvents={props.showScrollToEnd ? "auto" : "none"}
            accessibilityElementsHidden={!props.showScrollToEnd}
            importantForAccessibility={props.showScrollToEnd ? "auto" : "no-hide-descendants"}
            style={[arrowTransformStyle, arrowContentStyle]}
          >
            <ControlPill
              accessibilityLabel="Scroll to end"
              activateOnPressIn
              className="h-11 w-11 border border-border bg-glass-fallback shadow-md shadow-black/10"
              disabled={!props.showScrollToEnd}
              icon={{ ios: "chevron.down", android: "keyboard_arrow_down" }}
              onPress={props.onScrollToEnd}
            />
          </Animated.View>
        </View>
      ) : NATIVE_LIQUID_GLASS_SUPPORTED ? (
        <UniwindGlassView
          colorScheme={props.colorScheme}
          glassEffectStyle="regular"
          isInteractive
          className="h-11 w-11 items-center justify-center overflow-hidden rounded-full"
        >
          <ScrollToEndButton onPress={props.onScrollToEnd} />
        </UniwindGlassView>
      ) : (
        <ControlPill
          accessibilityLabel="Scroll to end"
          activateOnPressIn
          className="h-11 w-11 border border-border bg-glass-fallback shadow-md shadow-black/10"
          icon={{ ios: "chevron.down", android: "keyboard_arrow_down" }}
          onPress={props.onScrollToEnd}
        />
      )}
    </Animated.View>
  );
}

function CompactingLabel(props: { readonly onLayout: (event: LayoutChangeEvent) => void }) {
  return (
    <StatusLabelRow accessibilityLabel="Compacting" className="gap-1.5" onLayout={props.onLayout}>
      <SymbolView
        name="arrow.down.right.and.arrow.up.left"
        size={13}
        tintColorClassName="accent-primary-text"
        type="monochrome"
      />
      <Text className="font-e6-medium text-xs text-primary-text">Compacting…</Text>
    </StatusLabelRow>
  );
}

const AGENT_STATE_SYMBOL = {
  compacting: "arrow.down.right.and.arrow.up.left",
  retrying: "arrow.clockwise",
  "rate-limited": "pause.circle",
} as const;

function AgentStateLabel(props: {
  readonly agentState: ThreadAgentState;
  readonly onLayout: (event: LayoutChangeEvent) => void;
}) {
  // Only a countdown needs a clock, and it moves by the minute while shown.
  const nowMs = useMinuteClock(agentStateLabelTicks(props.agentState));
  const label = formatAgentStateLabel(props.agentState, nowMs);
  const paused = props.agentState.kind === "rate-limited";
  return (
    <StatusLabelRow accessibilityLabel={label} className="gap-1.5" onLayout={props.onLayout}>
      <SymbolView
        name={AGENT_STATE_SYMBOL[props.agentState.kind]}
        size={13}
        tintColorClassName={paused ? "accent-warning-foreground" : "accent-foreground"}
        type="monochrome"
      />
      <Text
        className={`max-w-[260px] shrink font-e6-medium text-xs ${
          paused ? "text-warning-foreground" : "text-foreground"
        }`}
        numberOfLines={1}
      >
        {label}
      </Text>
    </StatusLabelRow>
  );
}

function FloatingStatusLabel(props: {
  readonly status: FloatingWorkingStatus;
  readonly onLayout: (event: LayoutChangeEvent) => void;
}) {
  // Keyed by kind so a swap mounts a fresh row and the two cross-fade while
  // the capsule animates to the new row's measured width.
  if (props.status.kind === "syncing") {
    return (
      <StatusLabelRow
        key="syncing"
        accessibilityLabel={props.status.label}
        className="gap-2"
        onLayout={props.onLayout}
      >
        <ActivityIndicator size="small" colorClassName="accent-icon-muted" />
        <Text className="shrink font-e6-medium text-xs text-foreground" numberOfLines={1}>
          {props.status.label}
        </Text>
      </StatusLabelRow>
    );
  }
  if (props.status.kind === "compacting") {
    return <CompactingLabel key="compacting" onLayout={props.onLayout} />;
  }
  if (props.status.kind === "agent-state") {
    return (
      <AgentStateLabel
        key={`agent-state:${props.status.agentState.kind}`}
        agentState={props.status.agentState}
        onLayout={props.onLayout}
      />
    );
  }
  if (props.status.kind === "attention") {
    return (
      <StatusLabelRow
        key={`attention:${props.status.tone}`}
        accessibilityLabel={props.status.label}
        accessibilityRole="button"
        className="gap-2"
        onLayout={props.onLayout}
        onPress={props.status.onPress}
      >
        {/* Approval and answer are both blocked on you: one warning dot, told apart by the words. */}
        <View className="h-2 w-2 rounded-full bg-warning-foreground" />
        <Text
          className="max-w-[260px] shrink font-e6-medium text-xs text-foreground"
          numberOfLines={1}
        >
          {props.status.label}
        </Text>
      </StatusLabelRow>
    );
  }
  if (props.status.kind === "connection") {
    return (
      <StatusLabelRow
        key="connection"
        accessibilityLabel={props.status.label}
        accessibilityRole="button"
        className="gap-2"
        onLayout={props.onLayout}
        onPress={props.status.onPress}
      >
        {props.status.tone === "reconnecting" ? (
          <ActivityIndicator size="small" colorClassName="accent-icon-muted" />
        ) : (
          <View className="h-2 w-2 rounded-full bg-danger-foreground" />
        )}
        <Text
          className="max-w-[260px] shrink font-e6-medium text-xs text-foreground"
          numberOfLines={1}
        >
          {props.status.label}
        </Text>
      </StatusLabelRow>
    );
  }
  if (props.status.kind === "preparing") {
    return (
      <StatusLabelRow
        key="preparing"
        accessibilityLabel={props.status.label}
        className="gap-1.5"
        onLayout={props.onLayout}
      >
        <SymbolView
          name="arrow.triangle.branch"
          size={13}
          tintColorClassName="accent-foreground"
          type="monochrome"
        />
        <LiveWorkContent
          className="flex-none"
          textClassName="font-e6-medium"
          compact
          icon="arrow.triangle.branch"
          iconSubtleColor="transparent"
          label={props.status.label}
          showIcon={false}
        />
      </StatusLabelRow>
    );
  }
  return (
    <WorkingDuration
      key={props.status.plan ? "working:plan" : "working"}
      startedAt={props.status.startedAt}
      plan={props.status.plan ?? null}
      onLayout={props.onLayout}
      {...(props.status.onPress ? { onPress: props.status.onPress } : {})}
    />
  );
}

// Absolute rows cross-fade around the same center without affecting each other.
function StatusLabelRow(props: {
  readonly accessibilityLabel: string;
  readonly accessibilityRole?: "button";
  readonly className?: string;
  readonly children: ReactNode;
  readonly onLayout: (event: LayoutChangeEvent) => void;
  readonly onPress?: () => void;
  readonly accessibilityHint?: string;
}) {
  const rowClassName = `h-11 flex-row items-center px-4 ${props.className ?? ""}`;
  return (
    <Animated.View
      className="absolute max-w-full"
      entering={LABEL_ENTERING}
      exiting={LABEL_EXITING}
      onLayout={props.onLayout}
    >
      {props.onPress ? (
        <Pressable
          accessibilityLabel={props.accessibilityLabel}
          accessibilityRole={props.accessibilityRole}
          accessibilityHint={props.accessibilityHint}
          className={`${rowClassName} active:opacity-70`}
          onPress={props.onPress}
        >
          {props.children}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={props.accessibilityLabel} className={rowClassName}>
          {props.children}
        </View>
      )}
    </Animated.View>
  );
}

/**
 * The working row. Only {@link TickingDuration} updates each second (F5: one
 * ticking element); the dot, label and step meter render when the plan
 * changes, and the spoken label moves by whole minutes. With `onPress` it
 * is a button with board 9's chevron, opening Run details and its steps.
 */
function WorkingDuration(props: {
  readonly startedAt: string;
  readonly plan: PlanMeter | null;
  readonly onLayout: (event: LayoutChangeEvent) => void;
  readonly onPress?: () => void;
}) {
  const minuteMs = useMinuteClock(true);
  const spoken = spokenWorkingMinutes(props.startedAt, minuteMs);
  const chevron = props.onPress ? (
    <SymbolView
      name="chevron.right"
      size={14}
      tintColorClassName="accent-icon-muted"
      type="monochrome"
    />
  ) : null;
  const action = props.onPress
    ? {
        accessibilityRole: "button" as const,
        accessibilityHint: "Shows the plan and its steps.",
        onPress: props.onPress,
      }
    : {};

  if (props.plan !== null) {
    // Board 9: "Working", the step meter, "Step 3 of 5", the elapsed time, the chevron.
    return (
      <StatusLabelRow
        accessibilityLabel={`Working, ${props.plan.label}, ${spoken}`}
        className="gap-2"
        onLayout={props.onLayout}
        {...action}
      >
        <WorkingPlanLabel plan={props.plan} />
        <TickingDuration startedAt={props.startedAt} />
        {chevron}
      </StatusLabelRow>
    );
  }

  return (
    // The halo dot plus words: the live agent reads the same as the list.
    <StatusLabelRow
      accessibilityLabel={`Working for ${spoken}`}
      className="gap-2"
      onLayout={props.onLayout}
      {...action}
    >
      <WorkingHaloDot />
      <Text className="font-e6-medium text-2xs text-primary-text">Working</Text>
      <TickingDuration startedAt={props.startedAt} />
      {chevron}
    </StatusLabelRow>
  );
}

/** The dot, "Working", the step meter and the step label: unchanged between ticks. */
const WorkingPlanLabel = memo(function WorkingPlanLabel(props: { readonly plan: PlanMeter }) {
  return (
    <>
      <WorkingHaloDot />
      <Text className="font-e6-medium text-2xs text-primary-text">Working</Text>
      {props.plan.segments.length > 0 ? <StepMeter segments={props.plan.segments} /> : null}
      <Text
        className="shrink font-e6-medium text-[13px] leading-[18px] text-foreground"
        numberOfLines={1}
      >
        {props.plan.label}
      </Text>
    </>
  );
});

/**
 * The one element that ticks each second: board 9's time cue, mono 11/14 in
 * tabular numerals so nothing shifts.
 */
function TickingDuration(props: { readonly startedAt: string }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    setNowMs(Date.now());
    const intervalId = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(intervalId);
  }, [props.startedAt]);
  return (
    <SystemText
      className="text-[11px] leading-[14px] text-foreground-muted"
      style={{ fontFamily: MONO_FONT, fontVariant: ["tabular-nums"] }}
    >
      {formatWorkingDuration(props.startedAt, nowMs)}
    </SystemText>
  );
}

/** "under a minute", "1 minute", "12 minutes": what a screen reader hears. */
function spokenWorkingMinutes(startedAt: string, nowMs: number): string {
  const startedAtMs = Date.parse(startedAt);
  const minutes = Number.isFinite(startedAtMs)
    ? Math.max(0, Math.floor((nowMs - startedAtMs) / 60_000))
    : 0;
  if (minutes < 1) return "under a minute";
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/** Done steps fill in the success role, the live one in primary, the rest are outlined. */
function StepMeter(props: { readonly segments: PlanMeter["segments"] }) {
  return (
    <View className="flex-row gap-[3px]">
      {props.segments.map((segment, index) => (
        <View
          // The meter's order is its meaning; segments never reorder.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          className={
            segment === "done"
              ? "h-1.5 w-3.5 rounded-full bg-success-foreground"
              : segment === "live"
                ? "h-1.5 w-3.5 rounded-full bg-primary"
                : "h-1.5 w-3.5 rounded-full border border-foreground-muted"
          }
        />
      ))}
    </View>
  );
}

function formatWorkingDuration(startedAt: string, nowMs: number): string {
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs) || nowMs <= startedAtMs) {
    return "0s";
  }

  const totalSeconds = Math.floor((nowMs - startedAtMs) / 1_000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  if (totalSeconds >= 3_600) {
    return formatDuration(totalSeconds * 1_000);
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}m ${seconds}s`;
}

function ScrollToEndButton(props: { readonly disabled?: boolean; readonly onPress: () => void }) {
  return (
    <ControlPill
      accessibilityLabel="Scroll to end"
      activateOnPressIn
      className="h-11 w-11 bg-transparent"
      disabled={props.disabled}
      icon={{ ios: "chevron.down", android: "keyboard_arrow_down" }}
      onPress={props.onPress}
    />
  );
}
