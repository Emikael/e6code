import type { EnvironmentMachineKind } from "@e6tools/contracts";
import { ENVIRONMENT_MACHINE_ICON } from "@e6tools/design-tokens/icons";

/**
 * The semantic icon a machine kind draws. Mobile has no Linux brand mark, so linux keeps the
 * terminal, as before (ENG-88 decides the mark).
 */
export function environmentMachineIcon(kind: EnvironmentMachineKind) {
  const icon = ENVIRONMENT_MACHINE_ICON[kind];
  return typeof icon === "string" ? icon : ("terminal" as const);
}
