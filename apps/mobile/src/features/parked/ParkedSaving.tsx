/**
 * Asking where parked thoughts and notes are saved, shared by the Parked
 * screen and the sheets that park a thought or write a note: nothing goes to
 * an environment until the user accepts saving there.
 */
import { parkedOfferDetail, parkedOfferQuestion } from "@e6tools/client-runtime/parked-sync";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { setParkedConsent } from "../../state/parked";
import { SettingsSection } from "../settings/components/SettingsSection";

/** "Save parked thoughts and notes to Studio Mac?" with Save and Not now. */
export function ParkedOfferCard(props: { readonly environmentId: string; readonly label: string }) {
  return (
    <SettingsSection>
      <View className="gap-3 p-4">
        <Text className="text-base text-foreground">
          {parkedOfferQuestion({ thoughts: 0, notes: 0 }, props.label)}
        </Text>
        <Text className="text-sm text-foreground-muted">{parkedOfferDetail(props.label)}</Text>
        <View className="flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            onPress={() => setParkedConsent(props.environmentId, "accepted")}
            className="min-h-11 justify-center rounded-full bg-subtle-strong px-4 active:opacity-70"
          >
            <Text className="text-sm font-e6-medium text-foreground">Save</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setParkedConsent(props.environmentId, "declined")}
            className="min-h-11 justify-center rounded-full px-4 active:opacity-70"
          >
            <Text className="text-sm text-foreground">Not now</Text>
          </Pressable>
        </View>
      </View>
    </SettingsSection>
  );
}

/** "Save to Studio Mac", for an environment the user said Not now to. */
export function ParkedSaveToButton(props: {
  readonly environmentId: string;
  readonly label: string;
}) {
  return (
    <View className="gap-1 px-2">
      <Pressable
        accessibilityRole="button"
        accessibilityHint={parkedOfferDetail(props.label)}
        onPress={() => setParkedConsent(props.environmentId, "accepted")}
        className="min-h-11 justify-center active:opacity-70"
      >
        <Text className="text-sm text-foreground">{`Save to ${props.label}`}</Text>
      </Pressable>
      <Text className="text-xs text-foreground-muted">{parkedOfferDetail(props.label)}</Text>
    </View>
  );
}

/**
 * Why nothing can be parked yet, when no environment is accepted and none is
 * being offered: every one was declined, none runs a server that keeps a
 * Parked list, or none is connected.
 */
export function ParkedUnavailable(props: {
  readonly declined: boolean;
  readonly hasEnvironments: boolean;
  readonly supported: boolean;
}) {
  if (props.declined) {
    return (
      <EmptyState
        variant="plain"
        title="Parked is not saved anywhere"
        detail="Save parked thoughts to an environment to park them from this phone."
      />
    );
  }
  if (props.hasEnvironments && !props.supported) {
    return (
      <EmptyState
        title="Parked needs a newer server"
        detail="Connect to an environment running a version of E6 Code that keeps parked thoughts, and they show here."
      />
    );
  }
  return (
    <EmptyState
      title="Not connected"
      detail="Connect to an environment to park thoughts from this phone."
    />
  );
}

/** The accepted environments as choices, shown only when there are two or more. */
export function ParkedEnvironmentPicker(props: {
  readonly accepted: ReadonlyArray<{ readonly environmentId: string; readonly label: string }>;
  readonly target: string | null;
  readonly onPick: (environmentId: string) => void;
}) {
  if (props.accepted.length < 2) return null;
  return (
    <View className="flex-row flex-wrap items-center gap-2 px-3 pt-3">
      {props.accepted.map((environment) => {
        const selected = environment.environmentId === props.target;
        return (
          <Pressable
            key={environment.environmentId}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => props.onPick(environment.environmentId)}
            className={
              selected
                ? "min-h-11 justify-center rounded-full bg-subtle-strong px-3 active:opacity-70"
                : "min-h-11 justify-center rounded-full px-3 active:opacity-70"
            }
          >
            <Text className="text-sm text-foreground">
              {selected ? `Parks on ${environment.label}` : environment.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
