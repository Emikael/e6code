import { HoldToAllowButton } from "./HoldToAllowButton";
import { RequestActionButton } from "./RequestActionButton";
import { approvalSentLabel } from "@e6tools/client-runtime/approval-answers";
import { readApprovalFeedbackDraft } from "@e6tools/client-runtime/approval-feedback";
import { classifyDestructiveApproval } from "@e6tools/client-runtime/destructive-commands";
import type {
  ApprovalRequestId,
  ProviderApprovalDecision,
  ProviderApprovalOption,
} from "@e6tools/contracts";
import { useState } from "react";
import { View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import type { PendingApproval } from "../../lib/threadActivity";

export interface PendingApprovalCardProps {
  readonly approval: PendingApproval;
  /** Title of the subagent that asked; null when the main agent asked. */
  readonly agentTitle?: string | null;
  /** In flight or acknowledged on any surface: the actions are not offered again. */
  readonly answerState: "sending" | "sent" | null;
  /** "Codex", for "Sent. Waiting for Codex." */
  readonly agentName: string;
  /** Agent that decline instructions go to; null hides the instructions field. */
  readonly feedbackAgentName?: string | null;
  readonly onRespond: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
    feedback?: string,
  ) => Promise<unknown>;
}

const DEFAULT_APPROVAL_OPTIONS: ReadonlyArray<ProviderApprovalOption> = [
  { decision: "accept", label: "Allow once" },
  { decision: "acceptForSession", label: "Allow session" },
  { decision: "decline", label: "Decline" },
];

export function PendingApprovalCard(props: PendingApprovalCardProps) {
  const destructive = classifyDestructiveApproval(props.approval);
  // A destructive command is allowed one hold at a time, never for the session.
  const options: ReadonlyArray<ProviderApprovalOption> = (
    props.approval.options ?? DEFAULT_APPROVAL_OPTIONS
  ).filter(
    (option) =>
      destructive === null ||
      (option.decision !== "acceptForSession" && option.decision !== "acceptAlways"),
  );
  const warning = options.find((option) => option.warning)?.warning;
  const feedbackAgentName = props.feedbackAgentName ?? null;
  // The card is keyed by request, so instructions never carry to the next one.
  const [feedbackText, setFeedbackText] = useState("");
  const feedbackDraft = readApprovalFeedbackDraft(feedbackText);
  const responding = props.answerState !== null;
  // Opaque for the same reason as PendingUserInputCard: nothing blurs the feed
  // behind this card, so a translucent surface bleeds messages through it.
  return (
    <View className="gap-2.5 rounded-[20px] border border-border bg-card-alt p-4">
      {props.agentTitle ? (
        // The title shrinks first, so "needs approval" survives a long name.
        <View className="flex-row items-baseline">
          <Text
            className="min-w-0 shrink font-e6-bold text-2xs uppercase tracking-[1.1px] text-foreground-secondary"
            numberOfLines={1}
          >
            {props.agentTitle}
          </Text>
          <Text className="shrink-0 font-e6-bold text-2xs uppercase tracking-[1.1px] text-foreground-secondary">
            {" needs approval"}
          </Text>
        </View>
      ) : (
        <Text className="font-e6-bold text-2xs uppercase tracking-[1.1px] text-foreground-secondary">
          Approval needed
        </Text>
      )}
      <Text className="font-e6-bold text-lg text-foreground">
        {props.approval.appName ??
          (props.approval.unnamedKind ? "approval" : props.approval.requestKind)}
      </Text>
      {destructive ? (
        <View className="flex-row items-center gap-1.5">
          <SymbolView
            name="exclamationmark.triangle"
            size={13}
            tintColorClassName="accent-danger-foreground"
          />
          <Text className="font-e6-bold text-sm text-danger-foreground">{destructive.reason}</Text>
        </View>
      ) : null}
      {props.approval.detail ? (
        <Text className="font-sans text-sm leading-normal text-foreground-secondary">
          {props.approval.detail}
        </Text>
      ) : null}
      {warning ? (
        <Text className="font-sans text-xs leading-normal text-warning-foreground">{warning}</Text>
      ) : null}
      {feedbackAgentName !== null ? (
        <TextInput
          multiline
          accessibilityLabel={`Instructions for ${feedbackAgentName}`}
          value={feedbackText}
          editable={!responding}
          onChangeText={setFeedbackText}
          placeholder={`Tell ${feedbackAgentName} what to do instead…`}
          textAlignVertical="top"
          className="min-h-[54px] rounded-2xl border border-input-border bg-input px-3.5 py-3 font-sans text-base text-foreground"
        />
      ) : null}
      {feedbackDraft.status === "too-long" ? (
        <Text className="font-sans text-xs leading-normal text-danger-foreground">
          {`Shorten your instructions to ${feedbackDraft.maxChars.toLocaleString()} characters.`}
        </Text>
      ) : null}
      {props.answerState === "sent" ? (
        // Answered; the provider has not resolved it yet. Words, not a stuck control.
        <Text
          accessibilityLiveRegion="polite"
          className="font-sans text-sm leading-normal text-foreground-secondary"
        >
          {approvalSentLabel(props.agentName)}
        </Text>
      ) : null}
      {props.answerState === "sent" ? null : (
        <View className="flex-row flex-wrap gap-2.5">
          {options.flatMap((option) => {
            if (option.decision === "accept" && destructive !== null) {
              return [
                <HoldToAllowButton
                  key={option.decision}
                  reason={destructive.reason}
                  disabled={responding}
                  onConfirm={() => void props.onRespond(props.approval.requestId, "accept")}
                />,
              ];
            }
            const button = (
              <RequestActionButton
                key={option.decision}
                label={option.label}
                tone={
                  option.decision === "accept"
                    ? "primary"
                    : option.decision === "decline"
                      ? "danger"
                      : "secondary"
                }
                disabled={responding}
                onPress={() => void props.onRespond(props.approval.requestId, option.decision)}
              />
            );
            // Typed instructions add "Decline and tell <agent>" beside a plain
            // Decline, so declining without them never means clearing the field.
            if (
              option.decision !== "decline" ||
              feedbackAgentName === null ||
              feedbackDraft.status === "empty"
            ) {
              return [button];
            }
            return [
              button,
              <RequestActionButton
                key="decline-with-feedback"
                label={`Decline and tell ${feedbackAgentName}`}
                tone="danger"
                disabled={responding || feedbackDraft.status !== "ready"}
                onPress={() => {
                  if (feedbackDraft.status !== "ready") return;
                  void props.onRespond(props.approval.requestId, "decline", feedbackDraft.feedback);
                }}
              />,
            ];
          })}
        </View>
      )}
    </View>
  );
}
