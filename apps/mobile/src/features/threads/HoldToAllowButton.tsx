import { useState } from "react";
import { Pressable } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { AppText as Text } from "../../components/AppText";

/** Matches the web hold: a destructive command is allowed by a 1s press. */
const HOLD_TO_ALLOW_MS = 1000;

/**
 * Approve for destructive commands: a tap does nothing, a one-second long
 * press allows. The fill is one timing animation that runs only while the
 * button is pressed and snaps back on release; with reduced motion the label
 * says "Keep holding…" instead.
 */
export function HoldToAllowButton(props: {
  readonly reason: string;
  readonly disabled: boolean;
  readonly onConfirm: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const progress = useSharedValue(0);
  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.get() * 100}%` }));

  const release = () => {
    setPressed(false);
    cancelAnimation(progress);
    progress.set(0);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Hold to allow"
      accessibilityHint={`${props.reason}. Press and hold for one second to allow.`}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      delayLongPress={HOLD_TO_ALLOW_MS}
      onPressIn={() => {
        setPressed(true);
        if (reduceMotion) return;
        progress.set(withTiming(1, { duration: HOLD_TO_ALLOW_MS, easing: Easing.linear }));
      }}
      onPressOut={release}
      onLongPress={() => {
        release();
        props.onConfirm();
      }}
      className="items-center justify-center overflow-hidden rounded-[14px] border border-danger-border px-3.5 py-3 disabled:opacity-50"
    >
      {reduceMotion ? null : (
        <Animated.View
          pointerEvents="none"
          className="absolute top-0 bottom-0 left-0 bg-danger"
          style={fillStyle}
        />
      )}
      <Text className="font-e6-bold text-sm text-danger-foreground">
        {pressed && reduceMotion ? "Keep holding…" : "Hold to allow"}
      </Text>
    </Pressable>
  );
}
