/**
 * A few seconds of confirmation where web shows a toast: "Approved: vp test
 * run" after an approval is answered on Home, where the card simply goes, or
 * "Parked" after a thought is parked. Screen readers hear it from the
 * announcement the caller makes, so this one is hidden from them.
 */
import { useSyncExternalStore } from "react";
import { View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { SymbolView } from "./AppSymbol";
import { AppText as Text } from "./AppText";

const NOTICE_MS = 4_000;

let current: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function showBriefNotice(text: string): void {
  if (timer) clearTimeout(timer);
  current = text;
  emit();
  timer = setTimeout(() => {
    timer = null;
    current = null;
    emit();
  }, NOTICE_MS);
}

/**
 * Pinned above the bottom of a screen when `bottom` clears its toolbar or
 * FAB; without it, a row in place (above a thread's composer).
 */
export function BriefNotice(props: { readonly bottom?: number }) {
  const text = useSyncExternalStore(subscribe, () => current);
  if (text === null) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={
        props.bottom === undefined ? "items-center px-4 pb-3" : "absolute inset-x-4 items-center"
      }
      style={props.bottom === undefined ? undefined : { bottom: props.bottom }}
    >
      <Animated.View
        key={text}
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(160)}
        className="max-w-full flex-row items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5"
      >
        <SymbolView
          name="checkmark"
          size={14}
          tintColorClassName="accent-success-foreground"
          type="monochrome"
        />
        <Text className="shrink text-sm text-foreground" numberOfLines={2}>
          {text}
        </Text>
      </Animated.View>
    </View>
  );
}
