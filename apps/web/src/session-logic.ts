import * as Option from "effect/Option";
import * as Arr from "effect/Array";
import { shallow } from "zustand/vanilla/shallow";
import {
  compareActivitiesByOrder,
  type WorkLogEntry,
} from "@e6tools/client-runtime/work-log/entries";
import {
  workEntryIndicatesToolFailure,
  workEntryIndicatesToolSuccess,
  workLogEntryIsToolLike,
} from "@e6tools/client-runtime/work-log/presentation";
import { taskListStepsFromPayload } from "@e6tools/client-runtime/work-log/task-list";
import {
  type AssetResource,
  type OrchestrationLatestTurn,
  type OrchestrationThreadActivity,
  type OrchestrationProposedPlanId,
  type ThreadId,
  type TurnId,
} from "@e6tools/contracts";

import {
  isImageAttachment,
  type ChatAttachment,
  type ChatMessage,
  type ProposedPlan,
  type SessionPhase,
  type Thread,
  type ThreadSession,
  type TurnDiffSummary,
} from "./types";

export type { PendingApproval, PendingUserInput } from "@e6tools/client-runtime/pending-requests";

export { formatDuration } from "@e6tools/shared/orchestrationTiming";

export {
  workEntryDisplayIndicatesToolFailure,
  workEntryIndicatesToolSuccess,
  workLogEntryIsToolLike,
  type WorkLogToolLifecycleStatus,
} from "@e6tools/client-runtime/work-log/presentation";

export { deriveWorkLogEntries, type WorkLogEntry } from "@e6tools/client-runtime/work-log/entries";

export interface ActivePlanState {
  createdAt: string;
  turnId: TurnId | null;
  explanation?: string | null;
  steps: Array<{
    durationMs?: number;
    step: string;
    status: "pending" | "inProgress" | "completed";
  }>;
}

export interface LatestProposedPlanState {
  id: OrchestrationProposedPlanId;
  createdAt: string;
  updatedAt: string;
  turnId: TurnId | null;
  planMarkdown: string;
  implementedAt: string | null;
  implementationThreadId: ThreadId | null;
}

export type TimelineEntry =
  | {
      id: string;
      kind: "message";
      createdAt: string;
      message: ChatMessage;
    }
  | {
      id: string;
      kind: "proposed-plan";
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | {
      id: string;
      kind: "work";
      createdAt: string;
      entry: WorkLogEntry;
    };

export interface TimelineEntriesProjection {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly proposedPlans: ReadonlyArray<ProposedPlan>;
  readonly workEntries: ReadonlyArray<WorkLogEntry>;
  readonly entries: TimelineEntry[];
}

/** Severe failures keep the red treatment ordinary tool failures lost: runtime
 *  errors and orchestration `*.failed` activities (provider.turn.start.failed,
 *  checkpoint.capture.failed, ...) mean the turn or a core side effect broke,
 *  not that a command exited nonzero. */
export function workEntrySignalsSevereFailure(entry: WorkLogEntry): boolean {
  return (
    entry.sourceActivityKind === "runtime.error" ||
    entry.sourceActivityKind?.endsWith(".failed") === true
  );
}

/** Tool-like row with neither clear success nor failure (empty, incomplete, in progress, etc.). */
export function workEntryIndicatesToolNeutralStatus(entry: WorkLogEntry): boolean {
  // Spawn CTA rows are never neutral-hidden: mid-run they derive from
  // task.progress (tone "thinking") and the neutral filter was swallowing
  // them exactly while the fleet ran — the one moment they matter most.
  if (entry.agentSpawn !== undefined) {
    return false;
  }
  if (!workLogEntryIsToolLike(entry)) {
    return false;
  }
  if (workEntryIndicatesToolFailure(entry)) {
    return false;
  }
  if (workEntryIndicatesToolSuccess(entry)) {
    return false;
  }
  return true;
}

type LatestTurnTiming = Pick<OrchestrationLatestTurn, "turnId" | "startedAt" | "completedAt">;
type SessionActivityState = Pick<NonNullable<Thread["session"]>, "status" | "activeTurnId">;

export function isLatestTurnSettled(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
): boolean {
  if (!latestTurn?.startedAt) return false;
  if (!latestTurn.completedAt) return false;
  if (!session) return true;
  if (session.status === "running") return false;
  return true;
}

export function deriveActiveWorkStartedAt(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
  sendStartedAt: string | null,
  latestUserMessageAt: string | null = null,
): string | null {
  const runningTurnId = session?.status === "running" ? session.activeTurnId : null;
  if (runningTurnId !== null) {
    if (latestTurn?.turnId === runningTurnId) {
      return latestTurn.startedAt ?? sendStartedAt ?? latestUserMessageAt;
    }
    return sendStartedAt ?? latestUserMessageAt;
  }
  if (!isLatestTurnSettled(latestTurn, session)) {
    return latestTurn?.startedAt ?? sendStartedAt;
  }
  return sendStartedAt;
}

function planStateFromActivity(activity: OrchestrationThreadActivity): ActivePlanState | null {
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  const steps = taskListStepsFromPayload(payload);
  if (!steps || steps.length === 0) {
    return null;
  }
  return {
    createdAt: activity.createdAt,
    turnId: activity.turnId,
    ...(payload && "explanation" in payload
      ? { explanation: payload.explanation as string | null }
      : {}),
    steps,
  };
}

function addPlanStepDurations(
  plan: ActivePlanState,
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ActivePlanState {
  const timings = new Map<string, { completedAt?: number; startedAt?: number }>();
  let planStartedAt: number | undefined;

  const keyedSteps = (steps: ActivePlanState["steps"]) => {
    const occurrences = new Map<string, number>();
    return steps.map((step) => {
      const occurrence = occurrences.get(step.step) ?? 0;
      occurrences.set(step.step, occurrence + 1);
      return { key: `${step.step}:${occurrence}`, step };
    });
  };

  for (const activity of activities) {
    const snapshot = planStateFromActivity(activity);
    const activityAt = Date.parse(activity.createdAt);
    if (!snapshot || Number.isNaN(activityAt)) continue;
    planStartedAt ??= activityAt;

    for (const { key, step } of keyedSteps(snapshot.steps)) {
      const timing = timings.get(key) ?? {};
      if (step.status === "inProgress" && timing.startedAt === undefined) {
        timing.startedAt = activityAt;
      }
      if (step.status === "completed" && timing.completedAt === undefined) {
        timing.completedAt = activityAt;
      }
      timings.set(key, timing);
    }
  }

  const durationByKey = new Map<string, number>();
  let previousCompletedAt = planStartedAt;
  for (const [key, timing] of [...timings.entries()].toSorted(
    (left, right) => (left[1].completedAt ?? Infinity) - (right[1].completedAt ?? Infinity),
  )) {
    const completedAt = timing.completedAt;
    const startedAt = timing.startedAt ?? previousCompletedAt;
    if (completedAt === undefined) continue;
    if (startedAt !== undefined && completedAt > startedAt) {
      durationByKey.set(key, completedAt - startedAt);
    }
    previousCompletedAt = completedAt;
  }

  return {
    ...plan,
    steps: keyedSteps(plan.steps).map(({ key, step }) => {
      if (step.status !== "completed") return step;
      const durationMs = durationByKey.get(key);
      return durationMs === undefined ? step : { ...step, durationMs };
    }),
  };
}

export function deriveActivePlanState(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
): ActivePlanState | null {
  const allPlanActivities = activities
    .filter((activity) => activity.kind === "turn.plan.updated")
    .sort(compareActivitiesByOrder);
  // Prefer plan from the current turn; fall back to the most recent plan from any turn
  // so that TodoWrite tasks persist across follow-up messages.
  const latest = Option.firstSomeOf([
    ...(latestTurnId
      ? Arr.findLast(allPlanActivities, (activity) => activity.turnId === latestTurnId)
      : Option.none()),
    Arr.last(allPlanActivities),
  ]).pipe(Option.getOrNull);
  if (!latest) {
    return null;
  }
  const plan = planStateFromActivity(latest);
  if (!plan) return null;
  const matchingActivities = allPlanActivities.filter(
    (activity) => activity.turnId === latest.turnId,
  );
  const latestClearIndex = matchingActivities.findLastIndex(
    (activity) => planStateFromActivity(activity) === null,
  );
  return addPlanStepDurations(plan, matchingActivities.slice(latestClearIndex + 1));
}

export function findLatestProposedPlan(
  proposedPlans: ReadonlyArray<ProposedPlan>,
  latestTurnId: TurnId | string | null | undefined,
): LatestProposedPlanState | null {
  if (latestTurnId) {
    const matchingTurnPlan = [...proposedPlans]
      .filter((proposedPlan) => proposedPlan.turnId === latestTurnId)
      .toSorted(
        (left, right) =>
          left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
      )
      .at(-1);
    if (matchingTurnPlan) {
      return toLatestProposedPlanState(matchingTurnPlan);
    }
  }

  const latestPlan = [...proposedPlans]
    .toSorted(
      (left, right) =>
        left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
    )
    .at(-1);
  if (!latestPlan) {
    return null;
  }

  return toLatestProposedPlanState(latestPlan);
}

export function hasActionableProposedPlan(
  proposedPlan: LatestProposedPlanState | Pick<ProposedPlan, "implementedAt"> | null,
): boolean {
  return proposedPlan !== null && proposedPlan.implementedAt === null;
}

function toLatestProposedPlanState(proposedPlan: ProposedPlan): LatestProposedPlanState {
  return {
    id: proposedPlan.id,
    createdAt: proposedPlan.createdAt,
    updatedAt: proposedPlan.updatedAt,
    turnId: proposedPlan.turnId,
    planMarkdown: proposedPlan.planMarkdown,
    implementedAt: proposedPlan.implementedAt,
    implementationThreadId: proposedPlan.implementationThreadId,
  };
}

function timelineEntryFromMessage(message: ChatMessage): TimelineEntry {
  return {
    id: message.id,
    kind: "message",
    createdAt: message.createdAt,
    message,
  };
}

function timelineEntryFromProposedPlan(proposedPlan: ProposedPlan): TimelineEntry {
  return {
    id: proposedPlan.id,
    kind: "proposed-plan",
    createdAt: proposedPlan.createdAt,
    proposedPlan,
  };
}

function timelineEntryFromWork(workEntry: WorkLogEntry): TimelineEntry {
  return {
    id: workEntry.id,
    kind: "work",
    createdAt: workEntry.createdAt,
    entry: workEntry,
  };
}

function compareTimelineEntriesByCreatedAt(left: TimelineEntry, right: TimelineEntry): number {
  return left.createdAt.localeCompare(right.createdAt);
}

function timelineEntrySourceOrder(entry: TimelineEntry): number {
  switch (entry.kind) {
    case "message":
      return 0;
    case "proposed-plan":
      return 1;
    case "work":
      return 2;
  }
}

function shouldTakePreviousTimelineEntry(previous: TimelineEntry, suffix: TimelineEntry): boolean {
  const createdAtComparison = compareTimelineEntriesByCreatedAt(previous, suffix);
  if (createdAtComparison !== 0) return createdAtComparison < 0;
  // The original full derivation sorts a source-ordered array with a stable
  // comparator. On a tie, messages precede plans, plans precede work, and an
  // older item in the same source array precedes a newly appended item.
  return timelineEntrySourceOrder(previous) <= timelineEntrySourceOrder(suffix);
}

function hasExactArrayPrefix<T>(previous: ReadonlyArray<T>, next: ReadonlyArray<T>): boolean {
  if (previous === next) return true;
  if (next.length < previous.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) return false;
  }
  return true;
}

function mergeTimelineEntrySuffix(
  previous: ReadonlyArray<TimelineEntry>,
  suffix: ReadonlyArray<TimelineEntry>,
): TimelineEntry[] {
  if (suffix.length === 0) return [...previous];
  const previousLast = previous.at(-1);
  let suffixIsOrdered = true;
  for (let index = 1; index < suffix.length; index += 1) {
    if (compareTimelineEntriesByCreatedAt(suffix[index - 1]!, suffix[index]!) > 0) {
      suffixIsOrdered = false;
      break;
    }
  }
  if (
    suffixIsOrdered &&
    (previousLast === undefined || shouldTakePreviousTimelineEntry(previousLast, suffix[0]!))
  ) {
    return [...previous, ...suffix];
  }

  const merged: TimelineEntry[] = [];
  let previousIndex = 0;
  let suffixIndex = 0;
  while (previousIndex < previous.length || suffixIndex < suffix.length) {
    const previousEntry = previous[previousIndex];
    const suffixEntry = suffix[suffixIndex];
    if (
      previousEntry !== undefined &&
      (suffixEntry === undefined || shouldTakePreviousTimelineEntry(previousEntry, suffixEntry))
    ) {
      merged.push(previousEntry);
      previousIndex += 1;
    } else if (suffixEntry !== undefined) {
      merged.push(suffixEntry);
      suffixIndex += 1;
    }
  }
  return merged;
}

type AttachmentResource = Extract<AssetResource, { readonly _tag: "attachment" }>;
const EMPTY_IMAGE_RESOURCES = Object.freeze<ReadonlyArray<AttachmentResource>>([]);

/** A mounted row requests its stored images. Local previews keep their existing URLs. */
export function selectMessageImageResources(
  attachments: ChatMessage["attachments"],
): ReadonlyArray<AttachmentResource> {
  const attachmentIds = new Set<string>();
  for (const attachment of attachments ?? []) {
    if (!isImageAttachment(attachment)) continue;
    const previewUrl = attachment.previewUrl;
    if (previewUrl?.startsWith("blob:") || previewUrl?.startsWith("data:")) continue;
    attachmentIds.add(attachment.id);
  }
  return attachmentIds.size === 0
    ? EMPTY_IMAGE_RESOURCES
    : Array.from(attachmentIds, (attachmentId) => ({ _tag: "attachment", attachmentId }));
}

/** Handoffs need server URLs even while their message rows are unmounted. */
export function selectHandoffImageResources(
  messages: ReadonlyArray<ChatMessage> | undefined,
  handoffs: Readonly<Record<string, ReadonlyArray<string>>>,
): ReadonlyArray<AttachmentResource> {
  if (Object.keys(handoffs).length === 0) return EMPTY_IMAGE_RESOURCES;
  const attachmentIds = new Set<string>();
  for (const message of messages ?? []) {
    if (message.role !== "user" || !handoffs[message.id]?.length) continue;
    for (const attachment of message.attachments ?? []) {
      if (isImageAttachment(attachment)) attachmentIds.add(attachment.id);
    }
  }
  return attachmentIds.size === 0
    ? EMPTY_IMAGE_RESOURCES
    : Array.from(attachmentIds, (attachmentId) => ({ _tag: "attachment", attachmentId }));
}

/** Own one mapper per preview stage. Immutable messages retain unchanged preview objects. */
export function createMessageAttachmentPreviewProjector() {
  const attachmentsBySource = new WeakMap<
    ReadonlyArray<ChatAttachment>,
    ReadonlyArray<ChatAttachment>
  >();
  const messagesBySource = new WeakMap<ChatMessage, ChatMessage>();
  return (
    message: ChatMessage,
    previewUrlFor: (attachment: ChatAttachment) => string | undefined,
  ): ChatMessage => {
    const source = message.attachments;
    if (!source || source.length === 0) return message;
    const previous = attachmentsBySource.get(source) ?? source;
    let changed: ChatAttachment[] | undefined;
    let hasOverrides = false;
    for (const [index, attachment] of source.entries()) {
      const previewUrl = previewUrlFor(attachment);
      const sourceUrl = "previewUrl" in attachment ? attachment.previewUrl : undefined;
      const previousAttachment = previous[index]!;
      const previousUrl =
        "previewUrl" in previousAttachment ? previousAttachment.previewUrl : undefined;
      const next =
        !previewUrl || previewUrl === sourceUrl
          ? attachment
          : previewUrl === previousUrl
            ? previousAttachment
            : { ...attachment, previewUrl };
      hasOverrides ||= next !== attachment;
      if (next !== previousAttachment) {
        changed ??= previous.slice();
        changed[index] = next;
      }
    }
    const attachments = hasOverrides ? (changed ?? previous) : source;
    attachmentsBySource.set(source, attachments);
    if (attachments === source) {
      messagesBySource.delete(message);
      return message;
    }
    const previousMessage = messagesBySource.get(message);
    if (previousMessage?.attachments === attachments) return previousMessage;
    const result = { ...message, attachments };
    messagesBySource.set(message, result);
    return result;
  };
}

const streamsText = (role: ChatMessage["role"]) => role === "assistant" || role === "reasoning";

/** Text and update time do not change a streaming message's timeline structure. */
export function isStreamingMessageTextUpdate(previous: ChatMessage, next: ChatMessage): boolean {
  if (
    !streamsText(previous.role) ||
    previous.role !== next.role ||
    !previous.streaming ||
    !next.streaming
  ) {
    return false;
  }
  const { text: _previousText, updatedAt: _previousUpdatedAt, ...previousMetadata } = previous;
  const { text: _nextText, updatedAt: _nextUpdatedAt, ...nextMetadata } = next;
  return shallow(previousMetadata, nextMetadata);
}

function replaceStreamingTimelineMessages(
  messages: ReadonlyArray<ChatMessage>,
  previous: TimelineEntriesProjection,
): TimelineEntry[] | null {
  if (messages.length !== previous.messages.length) return null;
  const replacements = new Map<ChatMessage, ChatMessage>();
  for (const [index, message] of messages.entries()) {
    const previousMessage = previous.messages[index]!;
    if (message === previousMessage) continue;
    if (!isStreamingMessageTextUpdate(previousMessage, message)) return null;
    replacements.set(previousMessage, message);
  }
  if (replacements.size === 0) return previous.entries;
  return previous.entries.map((entry) => {
    const replacement = entry.kind === "message" ? replacements.get(entry.message) : undefined;
    return replacement ? timelineEntryFromMessage(replacement) : entry;
  });
}

/** Reuse ordered entries across immutable stream updates. Other changes keep the full sort. */
export function deriveTimelineEntriesWithState(
  messages: ReadonlyArray<ChatMessage>,
  proposedPlans: ReadonlyArray<ProposedPlan>,
  workEntries: ReadonlyArray<WorkLogEntry>,
  previous: TimelineEntriesProjection | null = null,
): TimelineEntriesProjection {
  if (
    previous !== null &&
    previous.proposedPlans.length === proposedPlans.length &&
    previous.workEntries.length === workEntries.length &&
    hasExactArrayPrefix(previous.proposedPlans, proposedPlans) &&
    hasExactArrayPrefix(previous.workEntries, workEntries)
  ) {
    const entries = replaceStreamingTimelineMessages(messages, previous);
    if (entries !== null) return { messages, proposedPlans, workEntries, entries };
  }
  const foldedAnswerMessageIds = new Set(
    workEntries.flatMap((entry) =>
      entry.questionAnswer ? [`async-answer:${entry.questionAnswer.requestId}`] : [],
    ),
  );
  const showMessage = (message: ChatMessage) =>
    message.role !== "user" || !foldedAnswerMessageIds.has(message.id);
  const canAppend =
    previous !== null &&
    !previous.entries.some((entry) => entry.kind === "message" && !showMessage(entry.message)) &&
    hasExactArrayPrefix(previous.messages, messages) &&
    hasExactArrayPrefix(previous.proposedPlans, proposedPlans) &&
    hasExactArrayPrefix(previous.workEntries, workEntries);

  if (canAppend) {
    const messageRows = messages
      .slice(previous.messages.length)
      .filter(showMessage)
      .map(timelineEntryFromMessage);
    const proposedPlanRows = proposedPlans
      .slice(previous.proposedPlans.length)
      .map(timelineEntryFromProposedPlan);
    const workRows = workEntries.slice(previous.workEntries.length).map(timelineEntryFromWork);
    const suffix = [...messageRows, ...proposedPlanRows, ...workRows].toSorted(
      compareTimelineEntriesByCreatedAt,
    );
    return {
      messages,
      proposedPlans,
      workEntries,
      entries: mergeTimelineEntrySuffix(previous.entries, suffix),
    };
  }

  const messageRows = messages.filter(showMessage).map(timelineEntryFromMessage);
  const proposedPlanRows = proposedPlans.map(timelineEntryFromProposedPlan);
  const workRows = workEntries.map(timelineEntryFromWork);
  return {
    messages,
    proposedPlans,
    workEntries,
    entries: [...messageRows, ...proposedPlanRows, ...workRows].toSorted(
      compareTimelineEntriesByCreatedAt,
    ),
  };
}

export function deriveTimelineEntries(
  messages: ReadonlyArray<ChatMessage>,
  proposedPlans: ReadonlyArray<ProposedPlan>,
  workEntries: ReadonlyArray<WorkLogEntry>,
): TimelineEntry[] {
  return deriveTimelineEntriesWithState(messages, proposedPlans, workEntries).entries;
}

export function inferCheckpointTurnCountByTurnId(
  summaries: ReadonlyArray<TurnDiffSummary>,
): Record<TurnId, number> {
  const sorted = [...summaries].toSorted((a, b) => a.completedAt.localeCompare(b.completedAt));
  const result: Record<TurnId, number> = {};
  for (let index = 0; index < sorted.length; index += 1) {
    const summary = sorted[index];
    if (!summary) continue;
    result[summary.turnId] = index + 1;
  }
  return result;
}

export function derivePhase(session: ThreadSession | null): SessionPhase {
  if (
    !session ||
    session.status === "stopped" ||
    session.status === "interrupted" ||
    session.status === "error"
  ) {
    return "disconnected";
  }
  if (session.status === "starting") return "connecting";
  if (session.status === "running") return "running";
  return "ready";
}
