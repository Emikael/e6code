/**
 * "Note to self" (F4): the note a thread's recap shows when you come back,
 * written from the thread's options menu or the recap's note. It is kept by
 * the thread's environment with the Parked list, so it needs the same
 * consent; Save with empty text, or Remove, clears it.
 */
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { mayParkIn } from "@e6tools/client-runtime/parked-sync";
import { EnvironmentId, PARKED_TEXT_MAX_CHARS, ThreadId } from "@e6tools/contracts";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text, AppTextInput } from "../../components/AppText";
import { ControlPill } from "../../components/ControlPill";
import { EmptyState } from "../../components/EmptyState";
import { uuidv4 } from "../../lib/uuid";
import { enqueueParked } from "../../state/parked";
import { parkedLengthCount, THREAD_NOTES_FULL_MESSAGE, threadNoteChange } from "./parkedListModel";
import { ParkedOfferCard, ParkedSaveToButton } from "./ParkedSaving";
import { ParkedSheetFrame } from "./ParkedSheetFrame";
import { useParkedEnvironments } from "./useParkedEnvironments";
import { useThreadNote } from "./useThreadNote";

type ThreadNoteSheetProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
}>;

export function ThreadNoteSheet(props: ThreadNoteSheetProps) {
  const navigation = useNavigation();
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  const threadId = ThreadId.make(props.route.params.threadId);
  const parked = useParkedEnvironments(environmentId);
  const note = useThreadNote(environmentId, threadId);
  const [draft, setDraft] = useState(note ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  const label = parked.labelOf(environmentId);
  const consent = parked.consents[environmentId];
  const lengthCount = parkedLengthCount(draft.length);
  const close = () => navigation.goBack();

  const save = (text: string) => {
    const change = threadNoteChange({
      lists: parked.lists,
      ops: parked.queue,
      environmentId,
      threadId,
      text,
      opId: uuidv4(),
      now: new Date().toISOString(),
    });
    if (change.kind === "full") {
      setNotice(THREAD_NOTES_FULL_MESSAGE);
      return;
    }
    if (change.kind === "save") enqueueParked(change.op);
    close();
  };

  return (
    <ParkedSheetFrame title="Note to self" onClose={close}>
      {mayParkIn(parked.consents, environmentId) ? (
        <>
          <Text className="px-1 text-sm text-foreground-muted">
            For when you come back. It shows in this thread's recap.
          </Text>
          <AppTextInput
            autoFocus
            multiline
            accessibilityLabel="Note to self"
            className="min-h-[120px] rounded-xl border-continuous bg-card px-3 py-3 text-base text-foreground"
            placeholder="Note to self"
            textAlignVertical="top"
            value={draft}
            maxLength={PARKED_TEXT_MAX_CHARS}
            onChangeText={(text) => {
              setDraft(text);
              setNotice(null);
            }}
          />
          {lengthCount ? (
            <Text className="px-1 text-xs text-foreground-muted">{lengthCount}</Text>
          ) : null}
          <View className="flex-row items-center gap-2">
            {note !== null ? (
              <ControlPill label="Remove" variant="pill" onPress={() => save("")} />
            ) : null}
            <View className="flex-1" />
            <ControlPill
              label="Save"
              variant="primary"
              disabled={draft.trim() === (note ?? "")}
              onPress={() => save(draft)}
            />
          </View>
          {notice ? <Text className="px-1 text-sm text-foreground-muted">{notice}</Text> : null}
        </>
      ) : consent === undefined && parked.available.includes(environmentId) ? (
        <ParkedOfferCard environmentId={environmentId} label={label} />
      ) : consent === "declined" ? (
        <>
          <Text className="px-1 text-sm text-foreground-muted">
            {`Notes to self are kept with Parked on ${label}, which you chose not to save to.`}
          </Text>
          <ParkedSaveToButton environmentId={environmentId} label={label} />
        </>
      ) : (
        <EmptyState
          title="Notes are not available yet"
          detail={`Notes to self are kept on ${label} once it is connected and runs a version of E6 Code that keeps parked thoughts.`}
        />
      )}
    </ParkedSheetFrame>
  );
}
