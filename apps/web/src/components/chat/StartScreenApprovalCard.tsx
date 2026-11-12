/**
 * The start screen's first approval, expanded with its real actions (board 1,
 * F3): what the agent wants, the command or path, then Approve, Decline and
 * More. It subscribes to that one thread's detail while mounted, and the
 * subscription ends when the card leaves.
 *
 * Approvals are easy to clear on impulse here, away from the thread, so:
 * nothing is bound to Enter or focused on arrival, "Always allow this
 * session" sits under More, a destructive command keeps hold-to-allow, and
 * there is no approve-all.
 */
import {
  approvalFeedbackAgentName,
  readApprovalFeedbackDraft,
} from "@e6tools/client-runtime/approval-feedback";
import { classifyDestructiveApproval } from "@e6tools/client-runtime/destructive-commands";
import { scopeProjectRef } from "@e6tools/client-runtime/environment";
import {
  derivePendingRequests,
  describeShownApprovalAsk,
} from "@e6tools/client-runtime/pending-requests";
import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/models";
import type { ProviderApprovalDecision, ThreadId } from "@e6tools/contracts";
import { ArrowRightIcon, EllipsisIcon, TriangleAlertIcon } from "lucide-react";
import * as Option from "effect/Option";
import { memo, useCallback, useId, useMemo, useState, type ReactNode } from "react";

import { useProject } from "~/state/entities";
import { useEnvironment } from "~/state/environments";
import { useEnvironmentThread } from "~/state/threads";
import { BlockedDiamond } from "../SidebarNeedsYou";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import {
  approvalAnswerAnnouncement,
  approvalMoreLabel,
  firstUnansweredRequest,
  layoutApprovalActions,
} from "./approvalActions";
import { asSentence } from "./DraftHeroFooter.logic";
import { HoldToAllowButton } from "./HoldToAllowButton";
import { useApprovalResponder, useApprovalSwapGuard } from "./useApprovalResponder";

const ACTION_CLASS = "sm:text-[13px]";
const EMPTY_ACTIVITIES: never[] = [];

export const StartScreenApprovalCard = memo(function StartScreenApprovalCard({
  thread,
  agent,
  fact,
  cue,
  onOpen,
}: {
  thread: EnvironmentThreadShell;
  /** "Codex": names the agent in the headline once the detail arrives. */
  agent: string;
  /** "Codex wants to run 1 command", from the shell until the detail arrives. */
  fact: string;
  /** "asked 4m ago". */
  cue: ReactNode;
  onOpen: () => void;
}) {
  const threadState = useEnvironmentThread(thread.environmentId, thread.id);
  const activities = Option.match(threadState.data, {
    onNone: () => EMPTY_ACTIVITIES,
    onSome: (detail) => detail.activities,
  });
  const approvals = useMemo(() => derivePendingRequests(activities).approvals, [activities]);
  const pendingRequestIds = useMemo(
    () => approvals.map((request) => request.requestId),
    [approvals],
  );
  const project = useProject(scopeProjectRef(thread.environmentId, thread.projectId));
  const providers = useEnvironment(thread.environmentId)?.serverConfig?.providers;
  const feedbackAgent = approvalFeedbackAgentName(
    providers?.find((provider) => provider.instanceId === thread.session?.providerInstanceId),
  );
  const onError = useCallback((_threadId: ThreadId, message: string) => {
    toastManager.add({
      type: "error",
      title: "Could not answer the approval",
      description: message,
    });
  }, []);
  const { respondingRequestIds, answeredRequestIds, respond } = useApprovalResponder({
    environmentId: thread.environmentId,
    threadId: thread.id,
    pendingRequestIds,
    onError,
  });
  // One request at a time. A request answered here stays in the detail until
  // the provider resolves it, so it is skipped rather than shown again.
  const shown = useMemo(
    () => firstUnansweredRequest(approvals, answeredRequestIds),
    [answeredRequestIds, approvals],
  );
  const approval = shown?.request ?? null;
  const destructive = useMemo(
    () => (approval ? classifyDestructiveApproval(approval) : null),
    [approval],
  );
  // The provider's own words stay in the thread's composer; here the card says
  // Approve and Decline (board 1). Cancel stops the turn, so it stays in the thread.
  const layout = layoutApprovalActions(approval?.options, destructive);
  const moreOptions = layout.more.filter((option) => option.decision !== "cancel");
  const activationAllowed = useApprovalSwapGuard(approval?.requestId ?? null);
  const [declineMessageOpen, setDeclineMessageOpen] = useState(false);
  const busy = approval === null || respondingRequestIds.includes(approval.requestId);
  const headline =
    approval && shown ? describeShownApprovalAsk(agent, approval.requestKind, shown) : null;
  const answer = (decision: ProviderApprovalDecision, feedback?: string, guarded = true) => {
    if (!approval || (guarded && !activationAllowed())) return;
    const what = approval.detail?.split("\n", 1)[0] || thread.title;
    void respond(approval.requestId, decision, feedback).then((result) => {
      // The card just disappears, so say what happened.
      if (result?._tag === "Success") {
        toastManager.add({ type: "info", title: approvalAnswerAnnouncement(decision, what) });
      }
    });
  };

  return (
    <article
      aria-label={`Approval: ${thread.title}`}
      className="flex flex-col gap-3 rounded-xl border border-warning-foreground bg-card px-4 py-3.5"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <BlockedDiamond />
        <h4 className="min-w-0 flex-1 truncate text-sm leading-5 font-semibold text-foreground">
          {thread.title}
        </h4>
        {project ? (
          <span className="inline-flex h-5 max-w-40 shrink-0 items-center truncate rounded-sm border border-input px-1.5 text-[11px] leading-[14px] font-medium tracking-[0.01em] text-muted-foreground">
            {project.title}
          </span>
        ) : null}
        {cue}
      </div>
      <p className="text-sm leading-[22px] text-foreground">
        {
          // Among several, the place ends the line; alone it is a plain sentence.
          headline !== null && (shown?.total ?? 0) > 1 ? headline : asSentence(headline ?? fact)
        }
      </p>
      {approval?.detail ? (
        <pre className="max-h-24 overflow-auto rounded-lg bg-surface-well px-3 py-2 font-mono text-[13px] leading-5 whitespace-pre text-foreground">
          {approval.detail}
        </pre>
      ) : null}
      {declineMessageOpen && approval && feedbackAgent ? (
        <DeclineWithMessage
          agentName={feedbackAgent}
          disabled={busy}
          onCancel={() => setDeclineMessageOpen(false)}
          // Typed and submitted on purpose, so no swap guard.
          onDecline={(feedback) => answer("decline", feedback, false)}
        />
      ) : null}
      <div
        // Keyed by request: a press that began on an answered request never
        // lands on the one that replaces it.
        key={approval?.requestId ?? "loading"}
        className="flex flex-wrap items-center gap-2"
      >
        {layout.approve?.kind === "hold" && approval ? (
          <HoldToAllowButton
            size="default"
            reason={layout.approve.reason}
            disabled={busy}
            // The thread's composer owns the held ⌘↵; nothing here answers to a key.
            shortcutEnabled={false}
            // A one-second hold is deliberate; no swap guard.
            onConfirm={() => answer("accept", undefined, false)}
          />
        ) : layout.approve ? (
          <Button
            className={ACTION_CLASS}
            disabled={busy}
            aria-description={layout.approve.option.warning}
            onClick={() => answer("accept")}
          >
            {layout.approve.option.warning ? <TriangleAlertIcon aria-hidden /> : null}
            Approve
          </Button>
        ) : null}
        {layout.decline ? (
          <Button
            variant="outline"
            className={ACTION_CLASS}
            disabled={busy}
            onClick={() => answer("decline")}
          >
            Decline
          </Button>
        ) : null}
        {moreOptions.length > 0 || feedbackAgent ? (
          <Menu>
            <MenuTrigger
              disabled={busy}
              render={
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={approvalMoreLabel(moreOptions, feedbackAgent !== null)}
                />
              }
            >
              <EllipsisIcon />
            </MenuTrigger>
            <MenuPopup align="start" className="w-60 max-w-[calc(100vw-2rem)]">
              {moreOptions.map((option) => (
                <MenuItem
                  key={option.decision}
                  aria-description={option.warning}
                  onClick={() => answer(option.decision)}
                >
                  {option.warning ? (
                    <TriangleAlertIcon aria-hidden className="size-3 text-warning-foreground" />
                  ) : null}
                  <span className="min-w-0 whitespace-normal">{option.label}</span>
                </MenuItem>
              ))}
              {feedbackAgent ? (
                <MenuItem onClick={() => setDeclineMessageOpen(true)}>
                  Decline with a message
                </MenuItem>
              ) : null}
            </MenuPopup>
          </Menu>
        ) : null}
        <span className="grow" />
        <Button
          variant="ghost"
          className={ACTION_CLASS}
          aria-label={`Open thread: ${thread.title}`}
          onClick={onOpen}
        >
          Open thread
          <ArrowRightIcon aria-hidden />
        </Button>
      </div>
    </article>
  );
});

/** "Decline with a message": what the agent should do instead, sent with the refusal. */
function DeclineWithMessage({
  agentName,
  disabled,
  onCancel,
  onDecline,
}: {
  agentName: string;
  disabled: boolean;
  onCancel: () => void;
  onDecline: (feedback: string) => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const draft = readApprovalFeedbackDraft(text);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-xs leading-4 text-muted-foreground">
        What should {agentName} do instead?
      </label>
      <textarea
        id={id}
        rows={2}
        value={text}
        // Opened from the menu on purpose, so the field takes focus.
        autoFocus
        onChange={(event) => setText(event.target.value)}
        className="w-full resize-none rounded-lg border border-input bg-card px-2.5 py-2 text-sm leading-[22px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {draft.status === "too-long" ? (
        <p className="text-xs leading-4 text-destructive-foreground">
          Keep it under {draft.maxChars.toLocaleString()} characters.
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || draft.status !== "ready"}
          onClick={() => {
            if (draft.status === "ready") onDecline(draft.feedback);
          }}
        >
          Decline and tell {agentName}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
