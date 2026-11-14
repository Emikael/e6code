import { approvalPhrase, approvalWordingKind } from "@e6tools/client-runtime/pending-requests";
import type { DestructiveCommand } from "@e6tools/client-runtime/destructive-commands";
import { TriangleAlertIcon } from "lucide-react";
import { memo } from "react";
import { type PendingApproval } from "../../session-logic";
import { cn } from "~/lib/utils";

interface ComposerPendingApprovalPanelProps {
  approval: PendingApproval;
  pendingCount: number;
  /** Title of the subagent that asked; null when the main agent asked. */
  agentTitle?: string | null;
  /** Shown above the command so the hold says what it would do. */
  destructive?: DestructiveCommand | null;
  className?: string;
}

export const ComposerPendingApprovalPanel = memo(function ComposerPendingApprovalPanel({
  approval,
  pendingCount,
  agentTitle = null,
  destructive = null,
  className,
}: ComposerPendingApprovalPanelProps) {
  const Detail = approval.requestKind === "mcp-elicitation" ? "span" : "code";
  const fallbackLabel = approval.unnamedKind
    ? "Approval request"
    : approval.requestKind === "mcp-elicitation"
      ? "App access approval"
      : approval.requestKind === "command"
        ? "Command approval"
        : approval.requestKind === "file-read"
          ? "File read approval"
          : approval.requestKind === "permission"
            ? "App permission approval"
            : "File change approval";
  const detailAriaLabel =
    approval.requestKind === "mcp-elicitation"
      ? "App access request"
      : approval.requestKind === "command"
        ? "Command"
        : approval.requestKind === "file-read"
          ? "File to read"
          : approval.requestKind === "permission"
            ? "Permission request"
            : "File change";

  const subagentVerb = agentTitle ? approvalPhrase(approvalWordingKind(approval)) : null;

  return (
    <span
      aria-label={agentTitle && subagentVerb ? `${agentTitle} ${subagentVerb}` : fallbackLabel}
      className={cn("flex min-w-0 flex-1 flex-col items-start gap-1", className)}
      role="group"
    >
      <span className="flex w-full min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
        {agentTitle && subagentVerb ? (
          // A subagent is blocked here: name it, so the user knows which one waits.
          <span className="flex min-w-0 items-baseline gap-1">
            <span className="min-w-0 truncate font-medium text-warning-foreground">
              {agentTitle}
            </span>
            <span className="shrink-0">{subagentVerb}</span>
          </span>
        ) : (
          <span className="shrink-0 font-medium text-warning-foreground">{fallbackLabel}</span>
        )}
        {destructive ? (
          <span className="flex min-w-0 items-center gap-1 font-medium text-destructive-foreground">
            <TriangleAlertIcon aria-hidden="true" className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{destructive.reason}</span>
          </span>
        ) : null}
        {approval.appName ? <span className="min-w-0 truncate">{approval.appName}</span> : null}
        {pendingCount > 1 ? (
          <span className="ml-auto shrink-0 tabular-nums">1/{pendingCount}</span>
        ) : null}
      </span>
      <Detail
        aria-label={detailAriaLabel}
        className={cn(
          "block max-h-20 w-full min-w-0 overflow-auto text-xs text-foreground [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 [&::-webkit-scrollbar]:h-1.5",
          approval.requestKind === "mcp-elicitation"
            ? "whitespace-pre-wrap font-sans wrap-break-word"
            : "whitespace-pre font-mono",
        )}
        data-approval-detail="complete"
        tabIndex={0}
      >
        {approval.detail || fallbackLabel}
      </Detail>
    </span>
  );
});
