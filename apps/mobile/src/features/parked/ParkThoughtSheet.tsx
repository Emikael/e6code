/**
 * "Park a thought" from Home or a thread (F7): one line, an optional project
 * (the thread's when opened from one), and Park. The thought goes into the
 * same queue the Parked list reads, so it is saved on an environment the user
 * accepted, and waits on this phone while that environment is unreachable.
 */
import type { MenuAction } from "@react-native-menu/menu";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId, PARKED_TEXT_MAX_CHARS, ParkedEntryId, ProjectId } from "@e6tools/contracts";
import { useState } from "react";
import { AccessibilityInfo, Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text, AppTextInput } from "../../components/AppText";
import { showBriefNotice } from "../../components/BriefNotice";
import { ControlPill, ControlPillMenu } from "../../components/ControlPill";
import { uuidv4 } from "../../lib/uuid";
import { useProjects } from "../../state/entities";
import { enqueueParked } from "../../state/parked";
import {
  canParkIn,
  PARKED_FULL_MESSAGE,
  parkedLengthCount,
  parkedProjectFor,
  parkedTarget,
} from "./parkedListModel";
import {
  ParkedEnvironmentPicker,
  ParkedOfferCard,
  ParkedSaveToButton,
  ParkedUnavailable,
} from "./ParkedSaving";
import { ParkedSheetFrame } from "./ParkedSheetFrame";
import { useParkedEnvironments } from "./useParkedEnvironments";

const NO_PROJECT = "no-project";

type ParkThoughtSheetProps = StaticScreenProps<{
  /** The thread's environment and project, preselected; absent from Home. */
  readonly environmentId?: string;
  readonly projectId?: string;
}>;

export function ParkThoughtSheet(props: ParkThoughtSheetProps) {
  const navigation = useNavigation();
  const from = props.route.params ?? {};
  const parked = useParkedEnvironments(from.environmentId ?? null);
  const projects = useProjects();
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pickedEnvironment, setPickedEnvironment] = useState(from.environmentId ?? null);
  const [pickedProject, setPickedProject] = useState(from.projectId ?? null);
  const target = parkedTarget(parked.accepted, pickedEnvironment);
  const projectId = parkedProjectFor(projects, target, pickedProject);
  const projectChoices = projects
    .filter((project) => project.environmentId === target)
    .sort((left, right) => left.title.localeCompare(right.title));
  const projectLabel =
    projectChoices.find((project) => project.id === projectId)?.title ?? "No project";
  const projectActions: MenuAction[] = [
    { id: NO_PROJECT, title: "No project", state: projectId === null ? "on" : undefined },
    ...projectChoices.map((project) => ({
      id: project.id,
      title: project.title,
      state: project.id === projectId ? ("on" as const) : undefined,
    })),
  ];
  const lengthCount = parkedLengthCount(draft.length);

  const park = () => {
    const text = draft.trim();
    if (text.length === 0 || target === null) return;
    const environmentId = EnvironmentId.make(target);
    if (!canParkIn(parked.rows, environmentId)) {
      setNotice(PARKED_FULL_MESSAGE);
      return;
    }
    enqueueParked({
      kind: "add",
      opId: uuidv4(),
      environmentId,
      entryId: ParkedEntryId.make(uuidv4()),
      text,
      projectId: projectId === null ? null : ProjectId.make(projectId),
      pinnedFor: null,
      createdAt: new Date().toISOString(),
    });
    navigation.goBack();
    showBriefNotice("Parked");
    AccessibilityInfo.announceForAccessibility("Parked");
  };

  return (
    <ParkedSheetFrame title="Park a thought" onClose={() => navigation.goBack()}>
      {parked.offer !== null && target === null ? (
        <ParkedOfferCard environmentId={parked.offer} label={parked.labelOf(parked.offer)} />
      ) : null}
      {target === null ? (
        parked.offer !== null ? null : (
          <>
            <ParkedUnavailable
              declined={parked.declinedAvailable.length > 0}
              hasEnvironments={parked.hasEnvironments}
              supported={parked.available.length > 0}
            />
            {parked.declinedAvailable.map((environmentId) => (
              <ParkedSaveToButton
                key={environmentId}
                environmentId={environmentId}
                label={parked.labelOf(environmentId)}
              />
            ))}
          </>
        )
      ) : (
        <>
          <ParkedEnvironmentPicker
            accepted={parked.accepted}
            target={target}
            onPick={setPickedEnvironment}
          />
          <AppTextInput
            autoFocus
            accessibilityLabel="Park a thought"
            className="min-h-11 rounded-xl border-continuous bg-card px-3 text-base text-foreground"
            placeholder="Park a thought"
            value={draft}
            maxLength={PARKED_TEXT_MAX_CHARS}
            onChangeText={(text) => {
              setDraft(text);
              setNotice(null);
            }}
            onSubmitEditing={park}
            returnKeyType="done"
          />
          {lengthCount ? (
            <Text className="px-1 text-xs text-foreground-muted">{lengthCount}</Text>
          ) : null}
          <View className="flex-row items-center gap-2">
            <ControlPillMenu
              accessible
              accessibilityLabel={`Project: ${projectLabel}`}
              accessibilityRole="button"
              actions={projectActions}
              onPressAction={({ nativeEvent }) =>
                setPickedProject(nativeEvent.event === NO_PROJECT ? null : nativeEvent.event)
              }
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Project: ${projectLabel}`}
                className="h-11 min-w-0 shrink flex-row items-center gap-2 rounded-full bg-subtle px-3.5 active:opacity-70"
              >
                <SymbolView
                  name="folder"
                  size={16}
                  tintColorClassName="accent-icon"
                  type="monochrome"
                />
                <Text className="shrink text-sm text-foreground" numberOfLines={1}>
                  {projectLabel}
                </Text>
                <SymbolView
                  name="chevron.down"
                  size={12}
                  tintColorClassName="accent-icon-muted"
                  type="monochrome"
                />
              </Pressable>
            </ControlPillMenu>
            <View className="flex-1" />
            <ControlPill
              label="Park"
              variant="primary"
              disabled={draft.trim().length === 0}
              onPress={park}
            />
          </View>
          {notice ? <Text className="px-1 text-sm text-foreground-muted">{notice}</Text> : null}
        </>
      )}
    </ParkedSheetFrame>
  );
}
