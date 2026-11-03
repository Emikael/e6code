import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { ComposerInlineControl } from "../../components/ComposerToolbar";
import { ProviderIcon } from "../../components/ProviderIcon";
import { RequestActionButton } from "./RequestActionButton";

/**
 * Offered above the composer when the active thread's provider hits its usage
 * limit. The model pill opens the model sheet for the new thread; Continue
 * starts it with a summary of this thread, which is never modified.
 */
export function ThreadHandoffCard(props: {
  readonly sourceLabel: string;
  /** Null when no other provider is available; `emptyReason` explains why. */
  readonly selection: { readonly label: string; readonly providerDriver: string | null } | null;
  readonly limitedNote: string | null;
  readonly emptyReason: string;
  readonly busy: boolean;
  readonly onOpenModel: () => void;
  readonly onContinue: () => void;
  readonly onDismiss: () => void;
}) {
  return (
    <View className="gap-2.5 rounded-[20px] border border-border-subtle bg-card-alt p-4">
      <Text className="font-e6-bold text-2xs uppercase tracking-[1.1px] text-warning-foreground">
        {props.sourceLabel} usage limit reached
      </Text>
      {props.selection ? (
        <>
          <Text className="font-sans text-sm leading-normal text-foreground-secondary">
            Continue in a new thread from a summary of this one.
          </Text>
          {/* Filled so it reads as a control on the card, unlike the composer's ghost pill. */}
          <View className="self-start rounded-xl bg-grouped-card">
            <ComposerInlineControl
              accessibilityHint="Chooses the model and effort for the new thread"
              accessibilityLabel={`Model for the new thread: ${props.selection.label}`}
              chevronDirection="right"
              disabled={props.busy}
              emphasized
              iconNode={<ProviderIcon provider={props.selection.providerDriver} size={16} />}
              label={props.selection.label}
              maxWidth="100%"
              onPress={props.onOpenModel}
            />
          </View>
        </>
      ) : (
        <Text className="font-sans text-sm leading-normal text-foreground-secondary">
          {props.emptyReason}
        </Text>
      )}
      {props.limitedNote && props.selection ? (
        <Text className="font-sans text-xs leading-normal text-foreground-secondary">
          {props.limitedNote}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        {props.selection ? (
          <RequestActionButton
            accessibilityHint={`Starts a new thread on ${props.selection.label} from a summary of this one`}
            accessibilityState={{ busy: props.busy }}
            disabled={props.busy}
            label={props.busy ? "Starting…" : "Continue"}
            onPress={props.onContinue}
          />
        ) : null}
        <RequestActionButton
          accessibilityHint="Hides this notice for this thread"
          disabled={props.busy}
          tone="secondary"
          label="Dismiss"
          onPress={props.onDismiss}
        />
      </View>
    </View>
  );
}
