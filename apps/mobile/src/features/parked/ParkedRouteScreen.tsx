/**
 * Parked on mobile (F7, phase 20): park a thought, see the list every device
 * connected to the same environment sees, start a task from one, or delete it
 * with Undo. Thoughts are kept by the environment; only environments that
 * advertise `parkedSync` take part, so the screen says when none does.
 */
import { useAtomValue } from "@effect/atom-react";
import { ParkedEntryId, ProjectId } from "@e6tools/contracts";
import { useMemo, useState } from "react";
import { Platform, Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text, AppTextInput } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { uuidv4 } from "../../lib/uuid";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { enqueueParked, parkedListsAtom, parkedQueueAtom } from "../../state/parked";
import { writeIncomingShareDraft } from "../sharing/incoming-share-storage";
import { useIncomingShare } from "../sharing/IncomingShareProvider";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { SettingsSection } from "../settings/components/SettingsSection";
import { buildParkedRows, canParkIn, formatParkedTime, type ParkedRow } from "./parkedListModel";

const PARKED_FULL_MESSAGE = "Parked is full. Remove one to add another.";

export function ParkedRouteScreen() {
  const lists = useAtomValue(parkedListsAtom);
  const queue = useAtomValue(parkedQueueAtom);
  const projects = useProjects();
  const { environments } = useEnvironments();
  const { refresh: refreshShares } = useIncomingShare();
  const rows = useMemo(() => buildParkedRows(lists, queue), [lists, queue]);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [removed, setRemoved] = useState<ParkedRow | null>(null);
  // A new thought goes to the first environment whose list has arrived.
  const target = lists.keys().next().value ?? null;
  const targetLabel =
    environments.find((environment) => environment.environmentId === target)?.label ?? null;

  const park = () => {
    const text = draft.trim();
    if (text.length === 0 || target === null) return;
    if (!canParkIn(rows, target)) {
      setNotice(PARKED_FULL_MESSAGE);
      return;
    }
    enqueueParked({
      kind: "add",
      opId: uuidv4(),
      environmentId: target,
      entryId: ParkedEntryId.make(uuidv4()),
      text,
      projectId: null,
      pinnedFor: null,
      createdAt: new Date().toISOString(),
    });
    setDraft("");
    setNotice(null);
    setRemoved(null);
  };

  const remove = (row: ParkedRow) => {
    enqueueParked({
      kind: "remove",
      opId: uuidv4(),
      environmentId: row.environmentId,
      entryId: row.entry.id,
    });
    setRemoved(row);
  };

  const undoRemove = () => {
    if (!removed) return;
    enqueueParked({
      kind: "add",
      opId: uuidv4(),
      environmentId: removed.environmentId,
      entryId: removed.entry.id,
      text: removed.entry.text,
      projectId: removed.entry.projectId,
      pinnedFor: removed.entry.pinnedFor,
      createdAt: removed.entry.createdAt,
    });
    setRemoved(null);
  };

  // The task flow opens on its own for a new shared draft, with the text in it.
  const startTask = async (row: ParkedRow) => {
    await writeIncomingShareDraft({
      schemaVersion: 1,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      text: row.entry.text,
      attachments: [],
      warnings: [],
    });
    await refreshShares();
  };

  // Only for "14:09" against an older date; a screen left open across midnight is rare.
  const [now] = useState(() => new Date());
  const projectTitle = (row: ParkedRow, projectId: ProjectId | null) =>
    projectId === null
      ? null
      : (projects.find(
          (project) => project.environmentId === row.environmentId && project.id === projectId,
        )?.title ?? null);

  return (
    <SettingsScreen title="Parked">
      {target === null ? (
        <EmptyState
          title="Parked needs a newer server"
          detail="Connect to an environment running a version of E6 Code that keeps parked thoughts, and they show here."
        />
      ) : (
        <SettingsSection>
          <View className="flex-row items-center gap-2 p-3">
            <AppTextInput
              accessibilityLabel="Park a thought"
              className="min-h-11 min-w-0 flex-1 rounded-xl border-continuous bg-card px-3 text-base text-foreground"
              placeholder="Park a thought"
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={park}
              returnKeyType="done"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Park"
              disabled={draft.trim().length === 0}
              onPress={park}
              className="rounded-full bg-subtle-strong px-4 py-2 active:opacity-70 disabled:opacity-40"
            >
              <Text className="text-sm font-e6-medium text-foreground">Park</Text>
            </Pressable>
          </View>
          {notice ? (
            <Text className="px-4 pb-3 text-sm text-foreground-muted">{notice}</Text>
          ) : null}
        </SettingsSection>
      )}

      {removed ? (
        <View className="flex-row items-center justify-between gap-3 px-2">
          <Text className="text-sm text-foreground-muted">Thought deleted.</Text>
          <Pressable accessibilityRole="button" onPress={undoRemove} className="px-2 py-1">
            <Text className="text-sm font-e6-medium text-foreground">Undo</Text>
          </Pressable>
        </View>
      ) : null}

      {rows.length > 0 ? (
        <SettingsSection title="Parked">
          {rows.map((row, index) => {
            const meta = [
              projectTitle(row, row.entry.projectId),
              formatParkedTime(row.entry.createdAt, now),
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <View
                key={`${row.environmentId}:${row.entry.id}`}
                className={index === 0 ? "gap-2 p-4" : "gap-2 border-t border-border-subtle p-4"}
              >
                <Text
                  className={
                    Platform.OS === "android"
                      ? "text-base text-foreground"
                      : "text-lg text-foreground"
                  }
                >
                  {row.entry.text}
                </Text>
                {meta ? <Text className="text-sm text-foreground-muted">{meta}</Text> : null}
                <View className="flex-row items-center gap-2">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Start a task: ${row.entry.text}`}
                    onPress={() => void startTask(row)}
                    className="rounded-full bg-subtle-strong px-3 py-1.5 active:opacity-70"
                  >
                    <Text className="text-sm font-e6-medium text-foreground">Start task</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete: ${row.entry.text}`}
                    onPress={() => remove(row)}
                    className="flex-row items-center gap-1 rounded-full px-3 py-1.5 active:opacity-70"
                  >
                    <SymbolView
                      name="trash"
                      size={16}
                      tintColorClassName="accent-icon"
                      type="monochrome"
                      weight="regular"
                    />
                    <Text className="text-sm text-foreground">Delete</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </SettingsSection>
      ) : target !== null ? (
        <EmptyState
          variant="plain"
          title="Nothing parked"
          detail="A thought parked here or on another device shows up here."
        />
      ) : null}

      {target !== null ? (
        <Text className="px-2 text-sm text-foreground-muted">
          {`Saved on ${targetLabel ?? "your environment"}, so your other devices see it too.`}
        </Text>
      ) : null}
    </SettingsScreen>
  );
}
