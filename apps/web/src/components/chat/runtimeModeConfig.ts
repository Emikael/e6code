import type { RuntimeMode } from "@e6tools/contracts";
import { type LucideIcon, LockIcon, PenLineIcon, ShieldOffIcon, SparklesIcon } from "lucide-react";

export const runtimeModeConfig: Record<
  RuntimeMode,
  { label: string; description: string; icon: LucideIcon }
> = {
  "approval-required": {
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: LockIcon,
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: PenLineIcon,
  },
  auto: {
    label: "Auto",
    description: "Supported providers approve routine actions; others still ask.",
    icon: SparklesIcon,
  },
  "full-access": {
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    // An open lock reads like a closed one at small sizes; a crossed shield does not.
    icon: ShieldOffIcon,
  },
};

export const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];

/**
 * Where the composer shows Permissions, so it has exactly one visible home: a labelled chip while
 * the thread runs on another mode, otherwise the effort menu when the model has one, otherwise an
 * icon-only chip.
 */
export function resolveRuntimeModeDisplay(input: {
  readonly matchesDefault: boolean;
  readonly hasTraitsMenu: boolean;
}): "label" | "icon" | "hidden" {
  if (!input.matchesDefault) return "label";
  return input.hasTraitsMenu ? "hidden" : "icon";
}
