import { HOLD_TO_CONFIRM_MS } from "@e6tools/client-runtime/destructive-commands";
import { useState } from "react";
import { Alert, Platform, Pressable } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { AppText as Text } from "../../components/AppText";
import { showConfirmDialog } from "../../components/ConfirmDialogHost";

/**
 * Asks before allowing, for people who cannot hold: a screen reader's
 * double-tap only presses, so the "Allow" action lands here instead.
 */
function confirmAllow(reason: string, onConfirm: () => void) {
  const title = "Allow this command?";
  const message = `${reason}.`;
  if (process.env.EXPO_OS === "ios") {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: "Allow", style: "destructive", onPress: onConfirm },
    ]);
    return;
  }
  showConfirmDialog({ title, message, confirmText: "Allow", destructive: true, onConfirm });
}

/**
 * Approve for destructive commands: a tap does nothing, a one-second long
 * press allows. The fill is one timing animation that runs only while the
 * button is pressed and snaps back on release; with reduced motion the label
 * says "Keep holding…" instead. Assistive tech gets an "Allow" action that
 * confirms in a dialog naming the reason.
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
      accessibilityHint={`${props.reason}. Press and hold for one second to allow, or use the Allow action to confirm in a dialog.`}
      accessibilityState={{ disabled: props.disabled }}
      accessibilityActions={[{ name: "allow", label: "Allow" }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName !== "allow" || props.disabled) return;
        confirmAllow(props.reason, props.onConfirm);
      }}
      disabled={props.disabled}
      delayLongPress={HOLD_TO_CONFIRM_MS}
      onPressIn={() => {
        setPressed(true);
        if (reduceMotion) return;
        progress.set(withTiming(1, { duration: HOLD_TO_CONFIRM_MS, easing: Easing.linear }));
      }}
      onPressOut={release}
      onLongPress={() => {
        release();
        props.onConfirm();
      }}
      className="items-center justify-center overflow-hidden rounded-[14px] border border-danger-border px-3.5 py-3 disabled:opacity-50"
      style={Platform.OS === "android" ? { minHeight: 48 } : undefined}
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
