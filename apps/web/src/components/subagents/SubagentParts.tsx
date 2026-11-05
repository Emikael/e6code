/**
 * Building blocks shared by the thread's subagent card and the Inspector.
 * Every status pairs a glyph with a word (or a tooltip title), so state is
 * never carried by color alone. Elapsed timers tick by writing their own text
 * node once a second, so a live fleet causes no React commits.
 */
import type { ProviderDriverKind } from "@e6tools/contracts";
import {
  formatSubagentElapsed,
  type RuntimeSubagent,
  SUBAGENT_STATUS_LABEL,
  subagentElapsedIsLive,
  subagentElapsedMs,
  type SubagentStatusTone,
} from "@e6tools/client-runtime/state/subagentRuntime";
import {
  BotIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CirclePauseIcon,
  CircleXIcon,
  SquareIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";

export const SUBAGENT_TONE_TEXT_CLASS: Readonly<Record<SubagentStatusTone, string>> = {
  working: "text-info-foreground",
  idle: "text-muted-foreground",
  done: "text-success-foreground",
  failed: "text-destructive-foreground",
  stopped: "text-muted-foreground",
};

/** Shape-distinct status glyph for dense rows (Inspector lineage). */
export function SubagentStatusGlyph({
  tone,
  className,
}: {
  tone: SubagentStatusTone;
  className?: string;
}) {
  const iconClassName = cn("size-3.5 shrink-0", SUBAGENT_TONE_TEXT_CLASS[tone], className);
  const label = SUBAGENT_STATUS_LABEL[tone];
  switch (tone) {
    case "working":
      return <CircleDashedIcon aria-label={label} role="img" className={iconClassName} />;
    case "idle":
      return <CirclePauseIcon aria-label={label} role="img" className={iconClassName} />;
    case "done":
      return <CircleCheckIcon aria-label={label} role="img" className={iconClassName} />;
    case "failed":
      return <CircleXIcon aria-label={label} role="img" className={iconClassName} />;
    case "stopped":
      return <SquareIcon aria-label={label} role="img" className={iconClassName} />;
  }
}

/** Status word with its leading mark: a dot while working, a glyph once settled. */
export function SubagentStatusWord({
  tone,
  className,
}: {
  tone: SubagentStatusTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs font-medium",
        SUBAGENT_TONE_TEXT_CLASS[tone],
        className,
      )}
    >
      {tone === "working" ? (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-info" />
      ) : tone === "done" ? (
        <CircleCheckIcon aria-hidden className="size-3 shrink-0" />
      ) : tone === "failed" ? (
        <CircleXIcon aria-hidden className="size-3 shrink-0" />
      ) : tone === "idle" ? (
        <CirclePauseIcon aria-hidden className="size-3 shrink-0" />
      ) : (
        <SquareIcon aria-hidden className="size-3 shrink-0" />
      )}
      {SUBAGENT_STATUS_LABEL[tone]}
    </span>
  );
}

/** Provider mark on a raised tile, monochrome so rows stay quiet. */
export function SubagentTile({
  driverKind,
  size = "md",
  className,
}: {
  driverKind: ProviderDriverKind | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const Icon = driverKind ? (PROVIDER_ICON_BY_PROVIDER[driverKind] ?? null) : null;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center border border-input bg-surface-raised text-foreground",
        size === "sm" && "size-4.5 rounded-[5px]",
        size === "md" && "size-5.5 rounded-md",
        size === "lg" && "size-7 rounded-lg",
        className,
      )}
    >
      {Icon ? (
        <Icon
          className={cn(
            "fill-current",
            size === "sm" ? "size-2.5" : size === "md" ? "size-3" : "size-3.5",
          )}
        />
      ) : (
        <BotIcon className={size === "lg" ? "size-4" : "size-3"} />
      )}
    </span>
  );
}

/** Elapsed time of the current activation, ticking while the agent is live. */
export function SubagentElapsed({
  agent,
  className,
}: {
  agent: Pick<RuntimeSubagent, "status" | "startedAt" | "completedAt">;
  className?: string;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  // Live rows rewrite their own text each second; the render only seeds it.
  const [mountedAt] = useState(Date.now);
  const live = subagentElapsedIsLive(agent.status);
  const { status, startedAt, completedAt } = agent;

  useEffect(() => {
    if (!live || !startedAt) return;
    const update = () => {
      const ms = subagentElapsedMs({ status, startedAt, completedAt }, Date.now());
      if (textRef.current)
        textRef.current.textContent = ms === null ? "" : formatSubagentElapsed(ms);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [live, status, startedAt, completedAt]);

  const ms = subagentElapsedMs(agent, mountedAt);
  if (ms === null) return null;
  return (
    <span ref={textRef} className={cn("font-mono tabular-nums", className)}>
      {formatSubagentElapsed(ms)}
    </span>
  );
}
