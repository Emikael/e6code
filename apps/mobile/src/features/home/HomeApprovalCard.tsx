/**
 * Board 8's first Needs you card: the first thread waiting on an approval,
 * expanded with Approve, Decline and More. It subscribes to that one thread's
 * detail while shown. A destructive command, a detail too long to show
 * whole, or a request still loading shows the ordinary row, which opens the
 * thread; once every request is answered, the row says it was sent.
 */
import {
  approvalActivationAllowed,
  approvalAnsweredLabel,
  approvalAnswerAnnouncement,
} from "@e6tools/client-runtime/approval-answers";
import { derivePendingRequests } from "@e6tools/client-runtime/pending-requests";
import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/shell";
import type { ThreadAttentionItem } from "@e6tools/client-runtime/state/thread-attention";
import type { ProviderApprovalDecision } from "@e6tools/contracts";
import * as Option from "effect/Option";
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { AccessibilityInfo, Pressable, ScrollView, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { ControlPillMenu } from "../../components/ControlPill";
import { threadEnvironment, useEnvironmentThread } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { sendApprovalAnswer, useApprovalAnswers } from "../../state/use-approval-answers";
import {
  BlockedDiamond,
  ThreadListV2NeedsYouRow,
  WholeMinutesSince,
} from "../threads/thread-list-v2-items";
import { THREAD_LIST_V2_MONO_FONT as MONO_FONT } from "../threads/thread-list-v2-row-appearance";
import { threadAgentName } from "../threads/threadListV2";
import { showApprovalAnswerNotice } from "./ApprovalAnswerNotice";
import { homeApprovalCardModel } from "./home-approval-card";

const NO_ACTIVITIES: never[] = [];
// Eight 20pt lines plus padding: the longest detail answered here fits whole.
const DETAIL_MAX_HEIGHT = 180;
const APPROVAL_RESPONSE_LABEL = "thread approval response";

export const HomeApprovalCard = memo(function HomeApprovalCard(props: {
  readonly item: ThreadAttentionItem<EnvironmentThreadShell>;
  readonly onSelectThread: (thread: EnvironmentThreadShell) => void;
}) {
  const { thread } = props.item;
  const detailState = useEnvironmentThread(thread.environmentId, thread.id);
  const activities = Option.match(detailState.data, {
    onNone: () => NO_ACTIVITIES,
    onSome: (detail) => detail.activities,
  });
  const approvals = useMemo(() => derivePendingRequests(activities).approvals, [activities]);
  const pendingRequestIds = useMemo(
    () => approvals.map((approval) => approval.requestId),
    [approvals],
  );
  // Answered here, in the thread or on another card: the client-wide store says.
  const {
    key: answersKey,
    answers,
    answered,
  } = useApprovalAnswers({
    environmentId: thread.environmentId,
    threadId: thread.id,
    pendingRequestIds,
    pendingKnown: Option.isSome(detailState.data),
  });
  const agent = threadAgentName(thread);
  const model = homeApprovalCardModel({
    approvals,
    answered,
    provider: agent,
    threadTitle: thread.title,
  });
  const shownRequestId = model.kind === "card" ? model.approval.requestId : null;
  // A request swapped in under a finger ignores taps for a moment.
  const shownAt = useRef(0);
  useLayoutEffect(() => {
    shownAt.current = performance.now();
  }, [shownRequestId]);
  // Failures are reported by sendApprovalAnswer, which knows a refused second answer is none.
  const respondToApproval = useAtomCommand(threadEnvironment.respondToApproval, {
    label: APPROVAL_RESPONSE_LABEL,
    reportFailure: false,
  });

  if (model.kind !== "card") {
    return (
      <ThreadListV2NeedsYouRow
        item={props.item}
        onSelectThread={props.onSelectThread}
        {...(model.kind === "sent"
          ? {
              note: approvalAnsweredLabel(
                pendingRequestIds.flatMap((id) => answers.get(id) ?? []),
                agent,
              ),
            }
          : {})}
      />
    );
  }

  const { approval } = model;
  const answer = (decision: ProviderApprovalDecision) => {
    if (!approvalActivationAllowed(shownAt.current, performance.now())) return;
    void sendApprovalAnswer(answersKey, approval.requestId, APPROVAL_RESPONSE_LABEL, () =>
      respondToApproval({
        environmentId: thread.environmentId,
        input: { threadId: thread.id, requestId: approval.requestId, decision },
      }),
    ).then((result) => {
      if (result?._tag !== "Success") return;
      // The card simply goes, so say what happened.
      const announcement = approvalAnswerAnnouncement(decision, model.what);
      showApprovalAnswerNotice(announcement);
      AccessibilityInfo.announceForAccessibility(announcement);
    });
  };

  return (
    <View className="px-4 pb-2">
      <View
        accessibilityLabel={`Approval: ${thread.title}`}
        className="gap-2.5 rounded-xl border border-warning-foreground bg-card p-3.5"
      >
        <View className="flex-row items-center gap-2.5">
          <BlockedDiamond />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open thread: ${thread.title}`}
            className="min-h-11 flex-1 justify-center"
            onPress={() => props.onSelectThread(thread)}
          >
            <Text
              className="text-base leading-[22px] font-e6-semibold text-foreground"
              numberOfLines={1}
            >
              {thread.title}
            </Text>
          </Pressable>
          {/* The age of the request shown, not of the oldest one. */}
          <WholeMinutesSince since={approval.createdAt} prefix="asked" />
        </View>
        <Text className="text-base leading-6 text-foreground">{model.headline}</Text>
        {approval.detail ? (
          // Every line, wrapped: nobody approves what they did not read. The
          // model sends anything longer than this shows whole to the thread.
          <ScrollView
            nestedScrollEnabled
            className="rounded-lg bg-subtle"
            style={{ maxHeight: DETAIL_MAX_HEIGHT }}
            contentContainerClassName="px-3 py-2.5"
          >
            <Text
              className="text-[13px] leading-5 text-foreground"
              style={{ fontFamily: MONO_FONT }}
            >
              {approval.detail}
            </Text>
          </ScrollView>
        ) : null}
        {/* Keyed by request: a press that began on an answered request never
            lands on the one that replaces it. Nothing here answers to a key. */}
        <View key={approval.requestId} className="flex-row items-center gap-2">
          {model.approve ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => answer("accept")}
              className="h-11 flex-1 items-center justify-center rounded-[10px] border border-primary-edge bg-primary px-4"
              style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
            >
              <Text className="text-[15px] font-e6-medium text-primary-foreground">Approve</Text>
            </Pressable>
          ) : null}
          {model.decline ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => answer("decline")}
              className="h-11 items-center justify-center rounded-[10px] border border-input-border bg-card px-4"
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <Text className="text-[15px] font-e6-medium text-foreground">Decline</Text>
            </Pressable>
          ) : null}
          {/* Board 8 always draws More; it is left out when the provider
              offers nothing for it, as an empty menu helps no one. */}
          {model.more.length > 0 ? (
            <ControlPillMenu
              accessible
              accessibilityRole="button"
              accessibilityLabel="More options"
              title="More options"
              actions={model.more.map((option) => ({
                id: option.decision,
                title: option.label,
                ...(option.warning ? { subtitle: option.warning } : {}),
              }))}
              onPressAction={({ nativeEvent }) => {
                const option = model.more.find((entry) => entry.decision === nativeEvent.event);
                if (option) answer(option.decision);
              }}
            >
              <View className="size-11 items-center justify-center">
                <SymbolView
                  name="ellipsis"
                  size={18}
                  tintColorClassName="accent-icon-muted"
                  type="monochrome"
                />
              </View>
            </ControlPillMenu>
          ) : null}
        </View>
      </View>
    </View>
  );
});
