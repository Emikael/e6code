/**
 * The environment a thread runs on and whether we can reach it, as words.
 * E6 runs local, over Tailscale and through tunnels, so the connection is part
 * of the UI: it lives in the thread header and never hides behind a menu.
 */
import type { EnvironmentConnectionPhase } from "@e6tools/client-runtime/connection";
import type { EnvironmentId } from "@e6tools/contracts";

import { useLocalEnvironmentWord } from "~/hooks/useLocalEnvironmentWord";
import { cn } from "~/lib/utils";
import { localEnvironmentDetailLines } from "~/localEnvironmentWord";
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
 * A quiet dot and word: "MacBook Pro · Connected". The word carries the state, the dot tints it.
 * Below the thread header's `@2xl/header-actions` width it compacts to the dot and the word; the
 * environment name stays for screen readers and in the tooltip. While the desktop's local
 * environment starts, its status gives the word ("Starting…") instead of the connection.
 */
export function EnvironmentConnectionChip({
  environmentId,
  className,
}: {
  environmentId: EnvironmentId;
  className?: string;
}) {
  const environment = useEnvironment(environmentId);
  const localWord = useLocalEnvironmentWord(environmentId);
  if (!environment) return null;
  const phase = localWord?.dotPhase ?? environment.connection.phase;
  const word = localWord?.word ?? connectionPhaseWord(phase);
  const details = localWord ? localEnvironmentDetailLines(localWord) : [];
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
      <TooltipPopup
        side="top"
        className={cn(details.length > 0 && "max-w-80 whitespace-pre-wrap leading-tight")}
      >
        {environment.label} · {word}
        {details.map((detail) => (
          <span key={detail.text} className={cn("block", detail.mono && "font-mono")}>
            {detail.text}
          </span>
        ))}
      </TooltipPopup>
    </Tooltip>
  );
}
