import type { EnvironmentMachineKind } from "@e6tools/contracts";
import { SymbolView } from "./AppSymbol";
import { environmentMachineIcon } from "./environmentMachineIcon";

export const ENVIRONMENT_MACHINE_KIND_LABELS: Record<EnvironmentMachineKind, string> = {
  server: "Server",
  cloud: "Cloud VM",
  linux: "Linux/WSL",
  desktop: "Desktop",
  laptop: "Laptop",
  "mac-mini": "Mini PC",
  "mac-studio": "Workstation",
};

/** The glyph an environment wears in lists; SF Symbols on iOS, Tabler on Android. */
export function EnvironmentMachineSymbol(props: {
  readonly kind: EnvironmentMachineKind;
  readonly size: number;
  readonly tintColorClassName: string;
}) {
  return (
    <SymbolView
      accessibilityLabel={ENVIRONMENT_MACHINE_KIND_LABELS[props.kind]}
      icon={environmentMachineIcon(props.kind)}
      size={props.size}
      tintColorClassName={props.tintColorClassName}
      type="monochrome"
    />
  );
}
