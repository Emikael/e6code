/**
 * Parked on mobile (F7, phase 20): park a thought, see the list every device
 * connected to the same environment sees, start a task from one, or delete it
 * with Undo. Thoughts are kept by an environment the user accepted saving to,
 * asked once per environment; nothing is sent to any other. A thought parked
 * while that environment is unreachable waits on this phone and shows here.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  mayParkIn,
  parkedOfferDetail,
  parkedOfferQuestion,
  selectParkedOfferEnvironment,
} from "@e6tools/client-runtime/parked-sync";
import { EnvironmentId, PARKED_TEXT_MAX_CHARS, ParkedEntryId, ProjectId } from "@e6tools/contracts";
import { useMemo, useState } from "react";
import { Platform, Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text, AppTextInput } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { uuidv4 } from "../../lib/uuid";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import {
  enqueueParked,
  parkedConsentsAtom,
  parkedEnvironmentIdsAtom,
  parkedListsAtom,
  parkedQueueAtom,
  setParkedConsent,
} from "../../state/parked";
import { writeIncomingShareDraft } from "../sharing/incoming-share-storage";
import { useIncomingShare } from "../sharing/IncomingShareProvider";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { SettingsSection } from "../settings/components/SettingsSection";
import {
  buildParkedRows,
  canParkIn,
  formatParkedTime,
  parkedTarget,
  type ParkedRow,
} from "./parkedListModel";

const PARKED_FULL_MESSAGE = "Parked is full. Remove one to add another.";

export function ParkedRouteScreen() {
  const lists = useAtomValue(parkedListsAtom);
  const queue = useAtomValue(parkedQueueAtom);
  const consents = useAtomValue(parkedConsentsAtom);
  const available = useAtomValue(parkedEnvironmentIdsAtom);
  const projects = useProjects();
  const { environments } = useEnvironments();
  const { refresh: refreshShares } = useIncomingShare();
  const labelOf = (environmentId: string) =>
    environments.find((environment) => environment.environmentId === environmentId)?.label ??
    "this environment";
  const accepted = Object.keys(consents)
    .filter((environmentId) => mayParkIn(consents, environmentId))
    .map((environmentId) => ({ environmentId, label: labelOf(environmentId) }));
  const acceptedIds = accepted.map((environment) => environment.environmentId);
  const acceptedKey = acceptedIds.join("\n");
  const rows = useMemo(
    () => buildParkedRows(lists, queue, acceptedKey === "" ? [] : acceptedKey.split("\n")),
    [lists, queue, acceptedKey],
  );
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [removed, setRemoved] = useState<ParkedRow | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  // A new thought goes to the accepted environment the user picked; a picker shows only for two or more.
  const target = parkedTarget(accepted, picked);
  const targetEnvironmentId = target === null ? null : EnvironmentId.make(target);
  const targetOnline = targetEnvironmentId !== null && lists.has(targetEnvironmentId);
  const offer = selectParkedOfferEnvironment({ consents, available, primaryEnvironmentId: null });
  const declinedAvailable = available.filter((id) => consents[id] === "declined");
  const lengthCount =
    draft.length >= PARKED_TEXT_MAX_CHARS * 0.8
      ? `${draft.length.toLocaleString("en-US")} / ${PARKED_TEXT_MAX_CHARS.toLocaleString("en-US")}`
      : null;

  const park = () => {
    const text = draft.trim();
    if (text.length === 0 || targetEnvironmentId === null) return;
    if (!canParkIn(rows, targetEnvironmentId)) {
      setNotice(PARKED_FULL_MESSAGE);
      return;
    }
    enqueueParked({
      kind: "add",
      opId: uuidv4(),
      environmentId: targetEnvironmentId,
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

  const offerCard =
    offer !== null ? (
      <SettingsSection>
        <View className="gap-3 p-4">
          <Text className="text-base text-foreground">
            {parkedOfferQuestion({ thoughts: 0, notes: 0 }, labelOf(offer))}
          </Text>
          <Text className="text-sm text-foreground-muted">{parkedOfferDetail(labelOf(offer))}</Text>
          <View className="flex-row items-center gap-2">
            <Pressable
              accessibilityRole="button"
              onPress={() => setParkedConsent(offer, "accepted")}
              className="min-h-11 justify-center rounded-full bg-subtle-strong px-4 active:opacity-70"
            >
              <Text className="text-sm font-e6-medium text-foreground">Save</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setParkedConsent(offer, "declined")}
              className="min-h-11 justify-center rounded-full px-4 active:opacity-70"
            >
              <Text className="text-sm text-foreground">Not now</Text>
            </Pressable>
          </View>
        </View>
      </SettingsSection>
    ) : null;

  return (
    <SettingsScreen title="Parked">
      {offerCard}
      {target === null ? (
        offer !== null ? null : declinedAvailable.length > 0 ? (
          <EmptyState
            variant="plain"
            title="Parked is not saved anywhere"
            detail="Save parked thoughts to an environment to park them from this phone."
          />
        ) : environments.length > 0 && available.length === 0 ? (
          <EmptyState
            title="Parked needs a newer server"
            detail="Connect to an environment running a version of E6 Code that keeps parked thoughts, and they show here."
          />
        ) : (
          <EmptyState
            title="Not connected"
            detail="Connect to an environment to park thoughts from this phone."
          />
        )
      ) : (
        <SettingsSection>
          {accepted.length > 1 ? (
            <View className="flex-row flex-wrap items-center gap-2 px-3 pt-3">
              {accepted.map((environment) => (
                <Pressable
                  key={environment.environmentId}
                  accessibilityRole="button"
                  accessibilityState={{ selected: environment.environmentId === target }}
                  onPress={() => setPicked(environment.environmentId)}
                  className={
                    environment.environmentId === target
                      ? "min-h-11 justify-center rounded-full bg-subtle-strong px-3 active:opacity-70"
                      : "min-h-11 justify-center rounded-full px-3 active:opacity-70"
                  }
                >
                  <Text className="text-sm text-foreground">
                    {environment.environmentId === target
                      ? `Parks on ${environment.label}`
                      : environment.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View className="flex-row items-center gap-2 p-3">
            <AppTextInput
              accessibilityLabel="Park a thought"
              className="min-h-11 min-w-0 flex-1 rounded-xl border-continuous bg-card px-3 text-base text-foreground"
              placeholder="Park a thought"
              value={draft}
              maxLength={PARKED_TEXT_MAX_CHARS}
              onChangeText={setDraft}
              onSubmitEditing={park}
              returnKeyType="done"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Park"
              disabled={draft.trim().length === 0}
              onPress={park}
              className="min-h-11 justify-center rounded-full bg-subtle-strong px-4 active:opacity-70 disabled:opacity-40"
            >
              <Text className="text-sm font-e6-medium text-foreground">Park</Text>
            </Pressable>
          </View>
          {lengthCount ? (
            <Text className="px-4 pb-2 text-xs text-foreground-muted">{lengthCount}</Text>
          ) : null}
          {notice ? (
            <Text className="px-4 pb-3 text-sm text-foreground-muted">{notice}</Text>
          ) : null}
        </SettingsSection>
      )}

      {removed ? (
        <View className="flex-row items-center justify-between gap-3 px-2">
          <Text className="text-sm text-foreground-muted">Thought deleted.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={undoRemove}
            className="min-h-11 justify-center px-3"
          >
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
              row.waiting && !lists.has(row.environmentId) ? "Waiting to be saved" : null,
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
                    className="min-h-11 justify-center rounded-full bg-subtle-strong px-3 active:opacity-70"
                  >
                    <Text className="text-sm font-e6-medium text-foreground">Start task</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete: ${row.entry.text}`}
                    onPress={() => remove(row)}
                    className="min-h-11 flex-row items-center gap-1 rounded-full px-3 active:opacity-70"
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
        <View className="gap-1 px-2">
          <Text className="text-sm text-foreground-muted">
            {targetOnline
              ? `Saved on ${labelOf(target)}, so your other devices see it too.`
              : `${labelOf(target)} is not connected. Thoughts parked now are saved when it is back.`}
          </Text>
          {accepted.map((environment) => (
            <Pressable
              key={environment.environmentId}
              accessibilityRole="button"
              onPress={() => setParkedConsent(environment.environmentId, "declined")}
              className="min-h-11 justify-center active:opacity-70"
            >
              <Text className="text-sm text-foreground">
                {accepted.length === 1 ? "Stop saving" : `Stop saving on ${environment.label}`}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {declinedAvailable.map((environmentId) => (
        <View key={environmentId} className="gap-1 px-2">
          <Pressable
            accessibilityRole="button"
            accessibilityHint={parkedOfferDetail(labelOf(environmentId))}
            onPress={() => setParkedConsent(environmentId, "accepted")}
            className="min-h-11 justify-center active:opacity-70"
          >
            <Text className="text-sm text-foreground">{`Save to ${labelOf(environmentId)}`}</Text>
          </Pressable>
          <Text className="text-xs text-foreground-muted">
            {parkedOfferDetail(labelOf(environmentId))}
          </Text>
        </View>
      ))}
    </SettingsScreen>
  );
}
