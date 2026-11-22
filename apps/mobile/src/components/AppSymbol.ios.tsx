import IconGitPullRequest from "@tabler/icons-react-native/IconGitPullRequest";
import { type SFSymbol, SymbolView as ExpoSymbolView } from "expo-symbols";
import { withUniwind } from "uniwind";
import type { AppSymbolViewProps } from "./AppSymbol";
import { iosSymbolFor } from "./appSymbolIcon";

export type { SFSymbol } from "expo-symbols";
export type { AppSymbolName } from "./AppSymbol";

/**
 * Use SF Symbols on iOS except for pull requests, which have no matching
 * native glyph. Import only that Tabler icon to keep the bundle small.
 * A registry `icon` draws its SF Symbol, and wins over `name`.
 */
function AppSymbolView({ icon, state, ...props }: AppSymbolViewProps) {
  // The registry types its `sf` names as strings; each one is an SF Symbol name.
  const symbol = icon === undefined ? props.name : (iosSymbolFor(icon, state) as SFSymbol);
  if (symbol === undefined) return props.fallback ?? null;

  const name = typeof symbol === "string" ? symbol : symbol.ios;
  if (name === "arrow.triangle.pull") {
    return (
      <IconGitPullRequest
        accessibilityLabel={props.accessibilityLabel}
        color={props.tintColor}
        size={props.size}
        strokeWidth={2}
        style={props.style}
        testID={props.testID}
      />
    );
  }

  return <ExpoSymbolView {...props} name={symbol} />;
}

export const SymbolView = withUniwind(AppSymbolView);
