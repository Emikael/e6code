import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Keyboard } from "react-native";
import { StackActions, useFocusEffect, useNavigation } from "@react-navigation/native";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ThreadId,
  type ModelSelection,
  type ServerConfig,
} from "@e6tools/contracts";
import {
  buildHandoffDocument,
  buildHandoffTurnInput,
  type HandoffMessage,
} from "@e6tools/client-runtime/state/thread-handoff";
import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/shell";

import { makeTurnCommandMetadata } from "../../lib/commandMetadata";
import { groupByProvider } from "../../lib/modelOptions";
import { resolveProviderOptionDescriptors } from "../../lib/providerOptions";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useStickyComposerModelSelection } from "../../state/use-composer-drafts";
import { resolveProviderInteractionMode } from "./legacy-plan-mode";
import { ThreadHandoffCard } from "./ThreadHandoffCard";
import {
  buildMobileHandoffCatalog,
  handoffSelectionLabel,
  isHandoffSelectionStartable,
  limitedHandoffNote,
  normalizeHandoffSelection,
  resolveHandoffDefaultSelection,
} from "./thread-handoff-selection";
import {
  type ExistingThreadSettingsRouteSession,
  useExistingThreadSettingsRoutePresentation,
} from "./ThreadSettingsSheet";
import { useLegacyPlanModeState } from "./use-legacy-plan-mode-enabled";

/**
 * Owns the usage-limit handoff for one thread. Mounted only while the notice
 * is offered, so the thread screen pays nothing for it otherwise and does not
 * subscribe to the shared settings-sheet slot.
 */
export function ThreadHandoffContainer(props: {
  readonly thread: EnvironmentThreadShell;
  readonly messages: ReadonlyArray<HandoffMessage>;
  readonly serverConfig: ServerConfig | null;
  readonly sourceInstanceId: string;
  readonly sourceLabel: string;
  readonly onDismiss: () => void;
}) {
  const navigation = useNavigation();
  const startHandoffTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const { present: presentSettingsRoute, clear: clearSettingsRoute } =
    useExistingThreadSettingsRoutePresentation();
  const stickyModelSelection = useStickyComposerModelSelection();
  const planMode = useLegacyPlanModeState();
  const [busy, setBusy] = useState(false);
  // A ref, not state, so two taps landing before a re-render cannot both start a thread.
  const startingRef = useRef(false);
  const ownerId = `handoff:${props.thread.id}:${props.sourceInstanceId}`;

  const catalog = useMemo(
    () => buildMobileHandoffCatalog(props.serverConfig, props.sourceInstanceId),
    [props.serverConfig, props.sourceInstanceId],
  );
  // Memoized so the open sheet's session is not rebuilt (and re-presented) every render.
  const defaultSelection = useMemo(
    () => resolveHandoffDefaultSelection(catalog, stickyModelSelection),
    [catalog, stickyModelSelection],
  );
  // The pick is dropped when it stops being offered, so Continue never starts on a limited provider.
  const [picked, setPicked] = useState<ModelSelection | null>(null);
  const selection =
    picked !== null && isHandoffSelectionStartable(catalog, picked) ? picked : defaultSelection;

  // The model sheet reads a session snapshot, so it is re-presented while open
  // and cleared when this screen regains focus (mirrors ThreadComposer).
  const sheetPresentedRef = useRef(false);
  const settingsSession = useMemo<ExistingThreadSettingsRouteSession | null>(() => {
    if (selection === null) return null;
    const selectedOption = catalog.options.find(
      (option) =>
        option.selection.instanceId === selection.instanceId &&
        option.selection.model === selection.model,
    );
    return {
      ownerId,
      title: "New thread",
      environmentId: props.thread.environmentId,
      providerGroups: groupByProvider(catalog.options),
      selectedModel: selection,
      onSelectModel: (option) => setPicked(option.selection),
      optionDescriptors: resolveProviderOptionDescriptors({
        capabilities: selectedOption?.capabilities,
        selections: selection.options,
      }),
      onUpdateOptionSelections: (options) => setPicked({ ...selection, options }),
    };
  }, [catalog, ownerId, props.thread.environmentId, selection]);
  useEffect(() => {
    if (sheetPresentedRef.current && settingsSession) presentSettingsRoute(settingsSession);
  }, [presentSettingsRoute, settingsSession]);
  useFocusEffect(
    useCallback(() => {
      if (!sheetPresentedRef.current) return;
      sheetPresentedRef.current = false;
      clearSettingsRoute(ownerId);
    }, [clearSettingsRoute, ownerId]),
  );
  useEffect(() => () => clearSettingsRoute(ownerId), [clearSettingsRoute, ownerId]);

  const openModelSheet = () => {
    if (!settingsSession || busy) return;
    sheetPresentedRef.current = true;
    presentSettingsRoute(settingsSession);
    Keyboard.dismiss();
    navigation.dispatch(StackActions.push("ThreadSettingsSheet"));
  };

  const handleContinue = async () => {
    // Re-checked here: a provider can reach its limit while the card is open.
    if (startingRef.current || !isHandoffSelectionStartable(catalog, selection)) return;
    const thread = props.thread;
    const targetProvider = props.serverConfig?.providers.find(
      (provider) => provider.instanceId === selection.instanceId,
    );
    startingRef.current = true;
    setBusy(true);
    try {
      const doc = buildHandoffDocument(
        {
          id: thread.id,
          title: thread.title,
          branch: thread.branch,
          modelLabel: props.sourceLabel,
          messages: props.messages,
        },
        { recentCount: 10 },
      );
      const metadata = makeTurnCommandMetadata();
      const input = buildHandoffTurnInput({
        source: {
          projectId: thread.projectId,
          title: thread.title,
          branch: thread.branch,
          worktreePath: thread.worktreePath,
          runtimeMode: thread.runtimeMode,
          // Same rule as the composer: Plan only when plan mode is on and the target supports it.
          interactionMode: planMode.enabled
            ? resolveProviderInteractionMode(targetProvider, thread.interactionMode)
            : DEFAULT_PROVIDER_INTERACTION_MODE,
        },
        handoffMarkdown: doc.markdown,
        target: normalizeHandoffSelection(catalog, selection),
        ids: {
          threadId: ThreadId.make(metadata.threadId),
          commandId: metadata.commandId,
          messageId: MessageId.make(metadata.messageId),
          createdAt: metadata.createdAt,
        },
      });
      const result = await startHandoffTurn({ environmentId: thread.environmentId, input });
      if (result._tag === "Failure") {
        Alert.alert(
          "Could not start the new thread",
          "The other provider could not be reached. Try again.",
        );
        return;
      }
      props.onDismiss();
      navigation.dispatch(
        StackActions.replace("Thread", {
          environmentId: String(thread.environmentId),
          threadId: String(metadata.threadId),
        }),
      );
    } finally {
      startingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <ThreadHandoffCard
      sourceLabel={props.sourceLabel}
      selection={
        selection
          ? {
              label: handoffSelectionLabel(catalog, selection),
              providerDriver:
                catalog.options.find((option) => option.providerKey === selection.instanceId)
                  ?.providerDriver ?? null,
            }
          : null
      }
      limitedNote={limitedHandoffNote(catalog.targets)}
      emptyReason={
        catalog.targets.length > 0
          ? "Every other provider has reached its usage limit."
          : "No other provider is available. Set one up on web or desktop."
      }
      busy={busy}
      onOpenModel={openModelSheet}
      onContinue={() => void handleContinue()}
      onDismiss={props.onDismiss}
    />
  );
}
