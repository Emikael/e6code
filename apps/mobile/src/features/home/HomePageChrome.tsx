/**
 * Board 8's page chrome around the Home list: the "Threads" title with the
 * connection line under it, and the "What should we work on?" composer
 * pinned at the bottom, which starts a new task.
 */
import { Platform, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useWorkspaceState } from "../../state/workspace";
import { THREAD_LIST_V2_MONO_FONT as MONO_FONT } from "../threads/thread-list-v2-row-appearance";
import { describeHomeConnectionLine } from "./workspace-connection-status";

/** "Threads", then "This Mac · connected over Tailscale", which opens the environments. */
export function HomeTitle(props: { readonly onOpenEnvironments: () => void }) {
  const { environments, state } = useWorkspaceState();
  const line = describeHomeConnectionLine({ state, environments });
  return (
    <View className="gap-0.5 px-4 pb-1 pt-2">
      <Text
        accessibilityRole="header"
        className="text-[28px] leading-[34px] font-e6-semibold text-foreground"
        style={{ letterSpacing: -0.56 }}
      >
        Threads
      </Text>
      {line ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={line}
          accessibilityHint="Opens environment settings."
          hitSlop={{ top: 12, bottom: 12 }}
          onPress={props.onOpenEnvironments}
          className="self-start"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text
            className="text-[11px] leading-[14px] text-foreground-muted"
            numberOfLines={1}
            style={{ fontFamily: MONO_FONT }}
          >
            {line}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The 48pt pill at the bottom of Home. It opens the new task composer. */
export function HomeComposerBar(props: {
  readonly bottom: number;
  readonly onStartNewTask: () => void;
}) {
  return (
    <View className="absolute inset-x-4" style={{ bottom: props.bottom }} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="What should we work on?"
        accessibilityHint="Starts a new task."
        onPress={props.onStartNewTask}
        className={
          Platform.OS === "android"
            ? "h-12 justify-center rounded-3xl border border-input-border bg-card px-4"
            : "h-12 justify-center rounded-3xl border border-input-border bg-card px-4 shadow-[0_6px_28px] shadow-adaptive-black-a15-a35"
        }
        style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
      >
        <Text className="text-base text-placeholder" numberOfLines={1}>
          What should we work on?
        </Text>
      </Pressable>
    </View>
  );
}
