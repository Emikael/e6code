import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AppSymbolName } from "./AppSymbol";
import { AppText as Text } from "./AppText";
import { cn } from "../lib/cn";
import { MaterialIconButton } from "./MaterialIconButton";
import { AndroidAnchoredMenu } from "./AndroidAnchoredMenu";
import { useScaledTextRole } from "../features/settings/appearance/useScaledTextRole";
import { useMaterialToolbarHeight } from "./useMaterialToolbarHeight";

export interface AndroidHeaderAction {
  readonly accessibilityLabel: string;
  readonly icon: AppSymbolName;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly selected?: boolean;
  /** Stable identity when the label carries changing state, such as a count. */
  readonly id?: string;
  /** Count drawn over the icon; the label must say the same thing. */
  readonly badge?: number;
}

export function AndroidHeaderIconButton(props: {
  readonly accessibilityLabel: string;
  readonly icon: AppSymbolName;
  readonly onPress?: () => void;
  readonly disabled?: boolean;
  readonly selected?: boolean;
}) {
  return <MaterialIconButton {...props} tintColorClassName="accent-header-foreground" />;
}

export function AndroidScreenHeader(props: {
  readonly title: string;
  readonly subtitle?: string | null;
  readonly actions?: ReadonlyArray<AndroidHeaderAction>;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly onBack?: () => void;
  readonly embedded?: boolean;
  readonly hideBottomBorder?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const titleTypography = useScaledTextRole("title");
  const subtitleTypography = useScaledTextRole("label");
  const materialToolbarHeight = useMaterialToolbarHeight();
  const [headerWidth, setHeaderWidth] = useState(0);
  const actions = props.actions ?? [];
  const directCount = actions.length > 2 ? (headerWidth >= 600 ? 3 : 1) : actions.length;
  const visibleActions = actions.slice(0, directCount);
  const overflowActions = actions.slice(directCount);

  return (
    <View
      onLayout={(event) => setHeaderWidth(event.nativeEvent.layout.width)}
      className="border-b border-header-border bg-header px-2 pb-2"
      style={{
        paddingTop: props.embedded ? 8 : Math.max(insets.top, 12),
        borderBottomWidth: props.hideBottomBorder ? 0 : undefined,
      }}
    >
      <View
        style={{ minHeight: materialToolbarHeight }}
        className="min-h-14 flex-row items-center gap-1"
      >
        {props.onBack ? (
          <MaterialIconButton
            accessibilityLabel="Navigate up"
            icon="arrow.left"
            tintColorClassName="accent-header-foreground"
            onPress={props.onBack}
          />
        ) : null}

        {props.leading}

        <View className={cn("min-w-0 flex-1", !props.onBack && "pl-1")}>
          <Text numberOfLines={1} style={titleTypography} className="text-header-foreground">
            {props.title}
          </Text>
          {props.subtitle ? (
            <Text
              numberOfLines={1}
              style={subtitleTypography}
              className="mt-px text-[13px] font-e6-medium text-foreground-muted"
            >
              {props.subtitle}
            </Text>
          ) : null}
        </View>

        {visibleActions.map((action) => (
          <View key={action.id ?? action.accessibilityLabel}>
            <AndroidHeaderIconButton
              accessibilityLabel={action.accessibilityLabel}
              disabled={action.disabled}
              selected={action.selected}
              icon={action.icon}
              onPress={action.onPress}
            />
            {action.badge !== undefined && action.badge > 0 ? (
              <View
                pointerEvents="none"
                importantForAccessibility="no-hide-descendants"
                className="absolute top-1.5 right-1 h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1"
              >
                <Text className="font-e6-bold text-3xs tabular-nums text-screen">
                  {action.badge > 99 ? "99+" : action.badge}
                </Text>
              </View>
            ) : null}
          </View>
        ))}
        {overflowActions.length > 0 ? (
          <AndroidAnchoredMenu
            actions={overflowActions.map((action, index) => ({
              id: String(index),
              title: action.accessibilityLabel,
              attributes: {
                disabled: Boolean(action.disabled),
                state: action.selected ? "on" : undefined,
              },
            }))}
            onPressAction={({ nativeEvent }) =>
              overflowActions[Number(nativeEvent.event)]?.onPress()
            }
          >
            {(open) => (
              <MaterialIconButton
                accessibilityLabel="More actions"
                icon="ellipsis"
                tintColorClassName="accent-header-foreground"
                onPress={open}
              />
            )}
          </AndroidAnchoredMenu>
        ) : null}
        {props.trailing}
      </View>
    </View>
  );
}

export function AndroidSheetHeader(
  props: Omit<Parameters<typeof AndroidScreenHeader>[0], "embedded">,
) {
  return <AndroidScreenHeader {...props} embedded />;
}
