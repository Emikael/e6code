import { useNavigation } from "@react-navigation/native";
import { useMemo } from "react";

/**
 * Opens "Park a thought" (with a thread's environment and project
 * preselected, from a thread) and the Parked list, from Home, a thread or
 * the command palette.
 */
export function useParkedNavigation() {
  const navigation = useNavigation();
  return useMemo(
    () => ({
      parkThought: (from?: { readonly environmentId: string; readonly projectId: string }) =>
        navigation.navigate("ParkThought", from ? { ...from } : {}),
      openParked: () =>
        navigation.navigate("SettingsSheet", {
          screen: "SettingsContent",
          params: { screen: "SettingsParked" },
        }),
    }),
    [navigation],
  );
}
