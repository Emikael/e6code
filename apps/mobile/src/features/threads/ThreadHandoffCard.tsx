import type { HandoffTargetOption } from "@e6tools/client-runtime/state/thread-handoff";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { RequestActionButton } from "./RequestActionButton";

/**
 * Offered above the composer when the active thread's provider hits its usage
 * limit. Picking a target starts a linked session on that provider carrying a
 * summary of this thread; the source thread is never modified.
 */
export function ThreadHandoffCard(props: {
  readonly sourceTitle: string;
  readonly targets: ReadonlyArray<HandoffTargetOption>;
  readonly busy: boolean;
  readonly onContinue: (target: HandoffTargetOption) => void;
  readonly onDismiss: () => void;
}) {
  const available = props.targets.filter((target) => target.available);
  return (
    <View className="gap-2.5 rounded-[20px] border border-border-subtle bg-card-alt p-4">
      <Text className="font-e6-bold text-2xs uppercase tracking-[1.1px] text-warning-foreground">
        Provider limit reached
      </Text>
      <Text className="font-sans text-sm leading-normal text-foreground-secondary">
        Continue &ldquo;{props.sourceTitle}&rdquo; on another provider with a summary of this
        session.
      </Text>
      {available.length === 0 ? (
        <Text className="font-sans text-xs leading-normal text-foreground-secondary">
          No other provider is available. Add one in settings to continue.
        </Text>
      ) : (
        <View className="flex-row flex-wrap gap-2">
          {available.map((target) => (
            <RequestActionButton
              key={target.instanceId}
              disabled={props.busy}
              label={props.busy ? "Starting…" : `Continue with ${target.label}`}
              onPress={() => props.onContinue(target)}
            />
          ))}
        </View>
      )}
      <View className="flex-row">
        <RequestActionButton tone="secondary" label="Dismiss" onPress={props.onDismiss} />
      </View>
    </View>
  );
}
