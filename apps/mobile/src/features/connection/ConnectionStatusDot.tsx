import { View } from "react-native";

import type { RemoteClientConnectionState } from "../../lib/connection";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { themeColorWithAlpha, type MobileThemeVariables } from "../../lib/mobileTheme";

export type ConnectionStatusDotState = RemoteClientConnectionState;

function statusDotTone(
  state: ConnectionStatusDotState,
  theme: MobileThemeVariables,
): {
  readonly dotColor: string;
  readonly haloColor: string;
} {
  switch (state) {
    // Unsupported is not a failure: the machine is fine, this build just
    // cannot talk to it, so it wears the same neutral dot as "available".
    case "available":
    case "unsupported":
      return {
        dotColor: theme["--color-icon-muted"],
        haloColor: themeColorWithAlpha(theme["--color-icon-muted"], 0.42),
      };
    case "connected":
      return {
        dotColor: theme["--color-success-foreground"],
        haloColor: themeColorWithAlpha(theme["--color-success-foreground"], 0.48),
      };
    case "connecting":
    case "reconnecting":
      return {
        dotColor: theme["--color-warning-foreground"],
        haloColor: themeColorWithAlpha(theme["--color-warning-foreground"], 0.5),
      };
    case "offline":
    case "error":
      return {
        dotColor: theme["--color-danger-foreground"],
        haloColor: themeColorWithAlpha(theme["--color-danger-foreground"], 0.48),
      };
  }
}

/** A status dot with an optional static halo for in-progress states. Nothing loops. */
export function ConnectionStatusDot(props: {
  readonly state: ConnectionStatusDotState;
  readonly halo: boolean;
  readonly size?: number;
}) {
  const { themeVariables } = useAppearancePreferences();
  const tone = statusDotTone(props.state, themeVariables);
  const dotSize = props.size ?? 10;
  const haloSize = dotSize + 4;
  const containerSize = haloSize + 4;

  return (
    <View
      style={{
        width: containerSize,
        height: containerSize,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {props.halo ? (
        <View
          style={{
            position: "absolute",
            width: haloSize,
            height: haloSize,
            borderRadius: haloSize / 2,
            backgroundColor: tone.haloColor,
            opacity: 0.6,
          }}
        />
      ) : null}
      <View
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          backgroundColor: tone.dotColor,
        }}
      />
    </View>
  );
}
