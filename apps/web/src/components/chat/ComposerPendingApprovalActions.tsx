import {
  type ApprovalRequestId,
  type ProviderApprovalDecision,
  type ProviderApprovalOption,
} from "@e6tools/contracts";
import type { ApprovalFeedbackDraft } from "@e6tools/client-runtime/approval-feedback";
import type { DestructiveCommand } from "@e6tools/client-runtime/destructive-commands";
import { Fragment, memo } from "react";
import { EllipsisIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { composerFloatingLayerProps } from "./composerEventScope";
import { DEFAULT_APPROVAL_OPTIONS, layoutApprovalActions } from "./approvalActions";
import { HoldToAllowButton } from "./HoldToAllowButton";

interface ComposerPendingApprovalActionsProps {
  requestId: ApprovalRequestId;
  isResponding: boolean;
  options?: ReadonlyArray<ProviderApprovalOption> | undefined;
  /** Instructions typed in the composer; with text, a second Decline sends them. */
  declineFeedback?: {
    readonly agentName: string;
    readonly draft: ApprovalFeedbackDraft;
  } | null;
  /** Set when the command is destructive: Approve becomes a hold. */
  destructive?: DestructiveCommand | null;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
    feedback?: string,
  ) => Promise<unknown>;
}

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  requestId,
  isResponding,
  options = DEFAULT_APPROVAL_OPTIONS,
  declineFeedback = null,
  destructive = null,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  const feedbackDraft = declineFeedback?.draft ?? null;
  const primaryOptions = options.filter(
    (option) => option.decision === "decline" || option.decision === "accept",
  );
  // A destructive command is allowed one hold at a time, never for the session.
  const moreOptions = layoutApprovalActions(options, destructive).more;

  return (
    <>
      {primaryOptions.map((option) => {
        if (option.decision === "accept" && destructive !== null) {
          return (
            <HoldToAllowButton
              key={option.decision}
              reason={destructive.reason}
              disabled={isResponding}
              // With instructions typed, ⌘↵ sends them instead.
              shortcutEnabled={feedbackDraft === null || feedbackDraft.status === "empty"}
              onConfirm={() => void onRespondToApproval(requestId, "accept")}
            />
          );
        }
        const button = (
          <Button
            key={option.decision}
            size="xs"
            variant={option.decision === "accept" ? "default" : "outline"}
            disabled={isResponding}
            aria-description={option.warning}
            onClick={() => void onRespondToApproval(requestId, option.decision)}
          >
            {option.warning ? <TriangleAlertIcon className="size-3 shrink-0" /> : null}
            <span className="max-w-40 truncate">{option.label}</span>
          </Button>
        );
        const decision = option.warning ? (
          <Tooltip key={option.decision}>
            <TooltipTrigger render={button} />
            <TooltipPopup side="top" className="max-w-72 text-xs leading-snug">
              {option.warning}
            </TooltipPopup>
          </Tooltip>
        ) : (
          button
        );
        // Typed instructions add "Decline and tell <agent>" beside a plain
        // Decline, so declining without them never means clearing the text.
        if (
          option.decision !== "decline" ||
          declineFeedback === null ||
          feedbackDraft === null ||
          feedbackDraft.status === "empty"
        ) {
          return decision;
        }
        return (
          <Fragment key={option.decision}>
            {decision}
            <Button
              size="xs"
              variant="outline"
              disabled={isResponding || feedbackDraft.status !== "ready"}
              onClick={() => {
                if (feedbackDraft.status !== "ready") return;
                void onRespondToApproval(requestId, "decline", feedbackDraft.feedback);
              }}
            >
              <span className="max-w-48 truncate">{`Decline and tell ${declineFeedback.agentName}`}</span>
            </Button>
          </Fragment>
        );
      })}
      {moreOptions.length > 0 ? (
        <Menu>
          <MenuTrigger
            disabled={isResponding}
            render={<Button size="icon-xs" variant="outline" aria-label="More approval options" />}
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup
            {...composerFloatingLayerProps}
            side="top"
            align="end"
            className="w-56 max-w-[calc(100vw-2rem)]"
          >
            {moreOptions.map((option) => {
              const item = (
                <MenuItem
                  key={option.decision}
                  disabled={isResponding}
                  aria-description={option.warning}
                  onClick={() => void onRespondToApproval(requestId, option.decision)}
                  variant="ghost"
                  className="mb-1 last:mb-0"
                >
                  {option.warning ? <TriangleAlertIcon className="size-3 text-warning" /> : null}
                  <span className="min-w-0 whitespace-normal wrap-break-word">{option.label}</span>
                </MenuItem>
              );
              return option.warning ? (
                <Tooltip key={option.decision}>
                  <TooltipTrigger render={item} />
                  <TooltipPopup side="top" className="max-w-64 text-xs leading-snug">
                    {option.warning}
                  </TooltipPopup>
                </Tooltip>
              ) : (
                item
              );
            })}
          </MenuPopup>
        </Menu>
      ) : null}
    </>
  );
});
