/**
 * "Approved: vp test run", shown for a few seconds after an approval is
 * answered on Home, where the card simply goes (web shows the same words as
 * a toast). Screen readers hear it from the announcement the card makes, so
 * this one is hidden from them.
 */
import { useSyncExternalStore } from "react";
import { View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";

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

export function showApprovalAnswerNotice(text: string): void {
  if (timer) clearTimeout(timer);
  current = text;
  emit();
  timer = setTimeout(() => {
    timer = null;
    current = null;
    emit();
  }, NOTICE_MS);
}

/** Pinned above the bottom of Home; `bottom` clears the toolbar or FAB. */
export function ApprovalAnswerNotice(props: { readonly bottom: number }) {
  const text = useSyncExternalStore(subscribe, () => current);
  if (text === null) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="absolute inset-x-4 items-center"
      style={{ bottom: props.bottom }}
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
