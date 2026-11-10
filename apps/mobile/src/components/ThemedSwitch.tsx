import { Platform, Switch, type SwitchProps } from "react-native";

import { MaterialSwitch } from "./MaterialSwitch";

export type ThemedSwitchProps = Pick<
  SwitchProps,
  | "accessibilityHint"
  | "accessibilityLabel"
  | "disabled"
  | "onValueChange"
  | "style"
  | "testID"
  | "value"
>;

export function ThemedSwitch(props: ThemedSwitchProps) {
  if (Platform.OS === "android") {
    return <MaterialSwitch {...props} />;
  }

  return (
    <Switch
      {...props}
      ios_backgroundColorClassName="accent-switch-inactive-track"
      trackColorOffClassName="accent-switch-inactive-track"
      trackColorOnClassName="accent-switch-active-track"
      // The system white thumb disappears on a light theme's accent track, so
      // an on switch takes the theme's action foreground, as on Android.
      thumbColorClassName={props.value ? "accent-switch-active-thumb" : undefined}
    />
  );
}
