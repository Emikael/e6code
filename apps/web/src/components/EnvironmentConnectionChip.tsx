/**
 * The environment a thread runs on and whether we can reach it, as words.
 * E6 runs local, over Tailscale and through tunnels, so the connection is part
 * of the UI: it lives in the thread header and never hides behind a menu.
 */
import type { EnvironmentConnectionPhase } from "@e6tools/client-runtime/connection";
import type { EnvironmentId } from "@e6tools/contracts";

import { cn } from "~/lib/utils";
import { useEnvironment } from "~/state/environments";
import { connectionPhaseDotClassName } from "./ConnectionStatusDot";

function connectionPhaseWord(phase: EnvironmentConnectionPhase): string {
  switch (phase) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting…";
    case "reconnecting":
      return "Reconnecting…";
    case "error":
      return "Connection failed";
    case "offline":
      return "Offline";
    case "available":
      return "Not connected";
    case "unsupported":
      return "Unsupported";
  }
}

/** A quiet dot and word: "MacBook Pro · Connected". The word carries the state, the dot tints it. */
export function EnvironmentConnectionChip({
  environmentId,
  className,
}: {
  environmentId: EnvironmentId;
  className?: string;
}) {
  const environment = useEnvironment(environmentId);
  if (!environment) return null;
  const phase = environment.connection.phase;
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex h-6 max-w-64 shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", connectionPhaseDotClassName(phase))}
      />
      <span className="min-w-0 truncate">{environment.label}</span>
      <span aria-hidden>·</span>
      <span className="shrink-0">{connectionPhaseWord(phase)}</span>
    </span>
  );
}
