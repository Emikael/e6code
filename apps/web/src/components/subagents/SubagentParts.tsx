/**
 * Building blocks shared by the thread's subagent card and the Inspector.
 * Every status pairs a glyph with a word (or a tooltip title), so state is
 * never carried by color alone. Elapsed timers tick by writing their own text
 * node once a second, so a live fleet causes no React commits.
 */
import type { ProviderDriverKind } from "@e6tools/contracts";
import { describeSubagentUserRequest } from "@e6tools/client-runtime/pending-requests";
import {
  formatSubagentElapsed,
  type RuntimeSubagent,
  subagentActivityText,
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
  MessageCircleQuestionIcon,
  SquareIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";

export const SUBAGENT_TONE_TEXT_CLASS: Readonly<Record<SubagentStatusTone, string>> = {
  approval: "text-warning-foreground",
  question: "text-warning-foreground",
  working: "text-info-foreground",
  idle: "text-muted-foreground",
  done: "text-success-foreground",
  failed: "text-destructive-foreground",
  stopped: "text-muted-foreground",
};

/**
 * Shape-distinct status glyph for dense rows (Inspector lineage). It names
 * itself unless `decorative`, for places where the status word sits beside it.
 */
export function SubagentStatusGlyph({
  tone,
  className,
  decorative = false,
}: {
  tone: SubagentStatusTone;
  className?: string;
  decorative?: boolean;
}) {
  const props = {
    className: cn("size-3.5 shrink-0", SUBAGENT_TONE_TEXT_CLASS[tone], className),
    ...(decorative
      ? { "aria-hidden": true as const }
      : { "aria-label": SUBAGENT_STATUS_LABEL[tone], role: "img" }),
  };
  switch (tone) {
    case "approval":
      return <TriangleAlertIcon {...props} />;
    case "question":
      return <MessageCircleQuestionIcon {...props} />;
    case "working":
      return <CircleDashedIcon {...props} />;
    case "idle":
      return <CirclePauseIcon {...props} />;
    case "done":
      return <CircleCheckIcon {...props} />;
    case "failed":
      return <CircleXIcon {...props} />;
    case "stopped":
      return <SquareIcon {...props} />;
  }
}

/**
 * Status word with its shape-distinct glyph. The solid dot is reserved for the
 * turn's own accent live signal, so a working subagent uses the dashed circle.
 */
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
      {tone === "approval" ? (
        <TriangleAlertIcon aria-hidden className="size-3 shrink-0" />
      ) : tone === "question" ? (
        <MessageCircleQuestionIcon aria-hidden className="size-3 shrink-0" />
      ) : tone === "working" ? (
        <CircleDashedIcon aria-hidden className="size-3 shrink-0" />
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

/**
 * A row's second line. A subagent blocked on the user says what it wants
 * ("wants to run `vp test`", "asks: Which branch?"); otherwise its latest
 * activity, falling back to the status word.
 */
export function SubagentActivityLine({
  agent,
  tone,
  className,
}: {
  agent: RuntimeSubagent;
  tone: SubagentStatusTone;
  className?: string;
}) {
  const request = agent.waitingOn ? describeSubagentUserRequest(agent.waitingOn) : null;
  return (
    <span
      className={cn(
        "truncate text-xs leading-[1.1875rem]",
        tone === "failed" ? "text-destructive-foreground" : "text-secondary-foreground",
        className,
      )}
    >
      {request ? (
        <>
          {request.text}
          {request.code ? (
            <>
              {" "}
              <code className="font-mono text-[11px] text-foreground">{request.code}</code>
            </>
          ) : null}
        </>
      ) : (
        (subagentActivityText(agent) ?? SUBAGENT_STATUS_LABEL[tone])
      )}
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
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const Icon = driverKind ? (PROVIDER_ICON_BY_PROVIDER[driverKind] ?? null) : null;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center border border-input bg-surface-raised text-foreground",
        size === "xs" && "size-4 rounded-[4px]",
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
            size === "xs" || size === "sm" ? "size-2.5" : size === "md" ? "size-3" : "size-3.5",
          )}
        />
      ) : (
        <BotIcon className={size === "lg" ? "size-4" : "size-3"} />
      )}
    </span>
  );
}

/**
 * Elapsed time of the current activation, ticking while the agent is live.
 * Renders a dash before the agent starts so the column keeps its width.
 */
export function SubagentElapsed({
  agent,
  className,
}: {
  agent: Pick<RuntimeSubagent, "status" | "startedAt" | "completedAt" | "updatedAt">;
  className?: string;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  // Live rows rewrite their own text each second; the render only seeds it.
  const [mountedAt] = useState(Date.now);
  const live = subagentElapsedIsLive(agent.status);
  const { status, startedAt, completedAt, updatedAt } = agent;

  useEffect(() => {
    if (!live || !startedAt) return;
    const update = () => {
      const ms = subagentElapsedMs({ status, startedAt, completedAt, updatedAt }, Date.now());
      if (textRef.current) {
        textRef.current.textContent = ms === null ? "–" : formatSubagentElapsed(ms);
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [live, status, startedAt, completedAt, updatedAt]);

  const ms = subagentElapsedMs(agent, mountedAt);
  return (
    <span ref={textRef} className={cn("tabular-nums", className)}>
      {ms === null ? "–" : formatSubagentElapsed(ms)}
    </span>
  );
}
