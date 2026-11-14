/**
 * The environment a thread runs on and whether we can reach it, as words.
 * E6 runs local, over Tailscale and through tunnels, so a connection problem is
 * part of the UI: it shows in the thread header, never behind a menu. A healthy
 * connection says nothing (board 2).
 */
import type { EnvironmentConnectionPhase } from "@e6tools/client-runtime/connection";
import type { EnvironmentId } from "@e6tools/contracts";

import { cn } from "~/lib/utils";
import { useEnvironment } from "~/state/environments";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { connectionPhaseDotClassName } from "./ConnectionStatusDot";

/** The connection phase in words, so no status is told by its dot alone. */
export function connectionPhaseWord(phase: EnvironmentConnectionPhase): string {
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

/**
 * A quiet dot and word: "MacBook Pro · Reconnecting…". The word carries the state, the dot tints it.
 * Below the thread header's `@2xl/header-actions` width it compacts to the dot and the word; the
 * environment name stays for screen readers and in the tooltip.
 */
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
  if (phase === "connected") return null;
  const word = connectionPhaseWord(phase);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="status"
            aria-live="polite"
            className={cn(
              "inline-flex h-6 max-w-64 shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground",
              className,
            )}
          />
        }
      >
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", connectionPhaseDotClassName(phase))}
        />
        <span className="sr-only @2xl/header-actions:not-sr-only @2xl/header-actions:min-w-0 @2xl/header-actions:truncate">
          {environment.label}
        </span>
        <span aria-hidden className="hidden @2xl/header-actions:inline">
          ·
        </span>
        <span className="shrink-0">{word}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">
        {environment.label} · {word}
      </TooltipPopup>
    </Tooltip>
  );
}
