/**
 * "Where you left off" above the composer (board 9, F4). Decided once when
 * the thread's log has loaded, then held still while the agent keeps working.
 * The visit is recorded when you open the thread and again when you leave it
 * or the app goes to the background.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ThreadRecap } from "@e6tools/client-runtime/work-log/thread-recap";
import { parkedNoteId, type EnvironmentId, type ThreadId } from "@e6tools/contracts";
import * as Option from "effect/Option";
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, View } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import {
  readThreadVisit,
  recordThreadVisit,
  type ThreadVisit,
} from "../../persistence/thread-visits";
import { parkedListsAtom } from "../../state/parked";
import { useSelectedThreadDetailState } from "../../state/use-thread-detail";
import { THREAD_LIST_V2_MONO_FONT as MONO_FONT } from "./thread-list-v2-row-appearance";
import {
  decideThreadRecap,
  formatRecapFiles,
  formatRecapSince,
  latestRecapActivityAt,
  type RecapThreadDetail,
} from "./thread-recap";

interface RecapHostState {
  readonly threadKey: string;
  readonly previous: ThreadVisit | null;
  /** Undefined until the thread's log has loaded and the recap was decided. */
  readonly recap: ThreadRecap | null | undefined;
}

/** The note to self parked for this thread, if any environment holds one. */
function useThreadNote(threadId: ThreadId): string | null {
  const lists = useAtomValue(parkedListsAtom);
  const noteId = parkedNoteId(threadId);
  for (const list of lists.values()) {
    const note = list.entries.find((entry) => entry.id === noteId);
    if (note) return note.text;
  }
  return null;
}

export function ThreadRecapHost(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** "Claude", or "The agent" when the provider is unknown. */
  readonly provider: string;
  /** False while another card owns the space above the composer. */
  readonly visible: boolean;
  readonly onOpenChanges: () => void;
}) {
  const { environmentId, threadId } = props;
  const threadKey = `${environmentId}:${threadId}`;
  const detailState = useSelectedThreadDetailState();
  const detail = Option.getOrNull(detailState.data);
  const ready = detailState.status === "live" && detail !== null && detail.id === threadId;
  const note = useThreadNote(threadId);

  const [state, setState] = useState<RecapHostState>(() => ({
    threadKey,
    previous: readThreadVisit(environmentId, threadId),
    recap: undefined,
  }));
  // A new thread starts over, reading its previous visit before this one is recorded.
  let current = state;
  if (current.threadKey !== threadKey) {
    current = { threadKey, previous: readThreadVisit(environmentId, threadId), recap: undefined };
    setState(current);
  }
  if (ready && current.recap === undefined) {
    // Decided once per visit, so the clock is read here rather than subscribed to.
    current = {
      ...current,
      recap: decideThreadRecap({
        detail,
        previous: current.previous,
        nowMs: Date.now(),
        provider: props.provider,
        note,
      }),
    };
    setState(current);
  }

  // The log on screen, read only when the visit is recorded.
  const detailRef = useRef<{
    readonly threadId: ThreadId;
    readonly detail: RecapThreadDetail;
  } | null>(null);
  if (ready) detailRef.current = { threadId, detail };
  useEffect(() => {
    const record = () => {
      // Leaving one thread for another: the ref may already hold the next one's log.
      const seen = detailRef.current?.threadId === threadId ? detailRef.current.detail : null;
      recordThreadVisit({
        environmentId,
        threadId,
        visitedAt: new Date().toISOString(),
        seenActivityAt: seen ? latestRecapActivityAt(seen) : null,
      });
    };
    record();
    const subscription = AppState.addEventListener("change", (appState) => {
      if (appState !== "active") record();
    });
    return () => {
      subscription.remove();
      record();
    };
  }, [environmentId, threadId]);

  if (!current.recap || !props.visible) return null;
  return (
    <Animated.View
      className="shrink-0 px-4 pb-3"
      entering={FadeInDown.duration(220)}
      exiting={FadeOut.duration(140)}
    >
      <ThreadRecapCard
        recap={current.recap}
        onDismiss={() => setState({ ...current, recap: null })}
        onOpenChanges={props.onOpenChanges}
      />
    </Animated.View>
  );
}

function RecapRow(props: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <View className="gap-0.5">
      <Text className="text-xs leading-4 font-e6-medium text-foreground-muted">{props.label}</Text>
      {props.children}
    </View>
  );
}

/** Board 9: what you asked, what changed since you left, your note, and the way to the changes. */
export function ThreadRecapCard(props: {
  readonly recap: ThreadRecap;
  readonly onDismiss: () => void;
  readonly onOpenChanges: () => void;
}) {
  const { recap } = props;
  const files = recap.sinceThen
    ? formatRecapFiles(recap.sinceThen.files, recap.sinceThen.moreFiles)
    : null;
  return (
    <View
      accessibilityLabel="Where you left off"
      className="gap-2.5 rounded-xl border border-border bg-card p-3.5"
    >
      <View className="flex-row items-center">
        <Text
          accessibilityRole="header"
          className="flex-1 text-sm font-e6-semibold text-foreground"
        >
          Where you left off
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss recap"
          hitSlop={4}
          onPress={props.onDismiss}
          className="-my-3 -mr-2.5 size-11 items-center justify-center"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <SymbolView
            name="xmark"
            size={16}
            tintColorClassName="accent-icon-muted"
            type="monochrome"
          />
        </Pressable>
      </View>
      {recap.youAsked ? (
        <RecapRow label="You asked">
          <Text className="text-[15px] leading-[22px] text-foreground" numberOfLines={3}>
            {recap.youAsked.text}
          </Text>
        </RecapRow>
      ) : null}
      {recap.sinceThen ? (
        <RecapRow label={`Changed since ${formatRecapSince(recap.since, Date.now())}`}>
          {recap.sinceThen.summary ? (
            <Text className="text-[15px] leading-[22px] text-foreground">
              {recap.sinceThen.summary}
            </Text>
          ) : null}
          {files ? (
            <Text
              className="text-[11px] leading-[14px] text-foreground-muted tabular-nums"
              style={{ fontFamily: MONO_FONT }}
              numberOfLines={2}
            >
              {files}
            </Text>
          ) : null}
        </RecapRow>
      ) : null}
      {recap.note ? (
        <RecapRow label="Your note">
          <Text className="text-[15px] leading-[22px] text-foreground" numberOfLines={3}>
            {recap.note}
          </Text>
        </RecapRow>
      ) : null}
      {recap.sinceThen && recap.sinceThen.files.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={props.onOpenChanges}
          className="h-11 items-center justify-center rounded-[10px] border border-input-border bg-card px-4"
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <Text className="text-[15px] font-e6-medium text-foreground">Changes so far</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
