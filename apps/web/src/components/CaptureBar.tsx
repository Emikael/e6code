/**
 * Park a thought (board 4, F7): one line, from anywhere, and you stay where
 * you are. Enter parks it, Mod+Enter starts a thread with it instead, Escape
 * closes. Mod+Alt+P opens it; Mod+S stays the composer's own "park this
 * draft" (decision 8).
 */
import { useAtomValue } from "@effect/atom-react";
import { parseScopedProjectKey } from "@e6tools/client-runtime/environment";
import { ChevronDownIcon, InboxIcon } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { isCommandPaletteOpen } from "../commandPaletteBus";
import { useParkedActions } from "../hooks/useParkedActions";
import { useClientSettings } from "../hooks/useSettings";
import { isMacPlatform } from "@e6tools/shared/keybindings";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { selectProjectGroupingSettings } from "../logicalProject";
import { isModelPickerOpen } from "../modelPickerVisibility";
import {
  PARKED_INPUT_MAX_CHARS,
  parkedLengthCount,
  parkThought,
  useCaptureBarStore,
} from "../parkedThoughts";
import { usePromptStashStore } from "../promptStashStore";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { useProjects } from "../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { primaryServerKeybindingsAtom } from "../state/server";
import { captureProjectOptions } from "./CaptureBar.logic";
import { ShortcutKeyCaps } from "./ShortcutKeyCaps";
import { ParkedListDialogHost } from "./sidebar/SidebarParked";
import { Button } from "./ui/button";
import { Dialog, DialogPopup, DialogTitle } from "./ui/dialog";
import { Kbd } from "./ui/kbd";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/menu";
import { toastManager } from "./ui/toast";

/** Root coordinator: the Mod+Alt+P listener, the one capture bar and the Parked dialog. */
export function CaptureBarHost() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const open = useCaptureBarStore((store) => store.open);
  const setOpen = useCaptureBarStore((store) => store.setOpen);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isCommandPaletteOpen() ||
        (event.target instanceof HTMLElement && event.target.closest("[data-keybinding-capture]"))
      )
        return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: false,
          previewFocus: isPreviewFocused(),
          previewOpen: false,
          editableFocus: isEditableFocused(event.target),
          modelPickerOpen: isModelPickerOpen(),
        },
      });
      if (command !== "capture.park") return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) useCaptureBarStore.getState().setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings]);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? <CaptureBar onClose={() => setOpen(false)} /> : null}
      </Dialog>
      <ParkedListDialogHost />
    </>
  );
}

function CaptureBar({ onClose }: { onClose: () => void }) {
  const { startThreadWith, currentProjectKey } = useParkedActions();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const projects = useProjects();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const inputId = useId();
  const [text, setText] = useState("");
  const [starting, setStarting] = useState(false);
  // The project on screen when it opened; the thought keeps it.
  const [projectKey, setProjectKey] = useState<string | null>(() => currentProjectKey());
  // One row per project as the app's other pickers group them, each parking into the
  // member on this machine when there is one.
  const projectOptions = useMemo(() => {
    const labelById = new Map(
      environments.map((environment) => [environment.environmentId, environment.label] as const),
    );
    return captureProjectOptions({
      groups: buildSidebarProjectSnapshots({
        projects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: (environmentId) => labelById.get(environmentId) ?? null,
      }),
      primaryEnvironmentId,
      preferredProjectRef: projectKey ? parseScopedProjectKey(projectKey) : null,
    });
  }, [environments, primaryEnvironmentId, projectGroupingSettings, projectKey, projects]);
  const selectedOption = projectOptions.find((option) =>
    option.memberKeys.includes(projectKey ?? ""),
  );
  const projectTitle = selectedOption?.label ?? "No project";
  const empty = text.trim().length === 0;
  const lengthCount = parkedLengthCount(text.length);
  const openShortcut = shortcutLabelForCommand(keybindings, "capture.park");
  const mac = isMacPlatform(navigator.platform);

  const park = () => {
    if (empty) return;
    const result = parkThought(text, projectKey);
    if (result.kind === "refused") {
      toastManager.add({ type: "error", title: result.message });
      return;
    }
    if (result.kind === "failed") {
      toastManager.add({
        type: "error",
        title: "Could not park this thought",
        description: "Browser storage rejected the write. Free up site data and try again.",
      });
      return;
    }
    onClose();
    const entryId = result.entry.id;
    toastManager.add({
      type: "success",
      title: "Parked",
      ...(result.durable
        ? {}
        : { description: "Browser storage is unavailable, so it is kept for this session only." }),
      actionProps: {
        children: "Undo",
        onClick: () => usePromptStashStore.getState().takeEntry(entryId),
      },
    });
  };

  // The bar closes only once the thread exists, so a failure leaves the text where it was.
  const startThread = async () => {
    if (empty || starting) return;
    setStarting(true);
    const started = await startThreadWith(text.trim(), projectKey).catch(() => false);
    setStarting(false);
    if (started) {
      onClose();
      return;
    }
    toastManager.add({
      type: "error",
      title: "Could not start a thread",
      description:
        projectOptions.length === 0
          ? "Add a project first. Your text is still in the bar, so you can park it."
          : "Your text is still in the bar. Try again, or park it.",
    });
  };

  return (
    // Board 10: the bar opens from scale 0.98 and 4px up in 120ms. Closing unmounts it at once.
    <DialogPopup
      showCloseButton={false}
      bottomStickOnMobile={false}
      viewportClassName="grid-rows-[0.6fr_auto_1fr]"
      backdropClassName="duration-120 motion-reduce:transition-none"
      className="max-w-110 overflow-hidden rounded-xl duration-120 ease-(--ease-motion-out) data-starting-style:-translate-y-1 motion-reduce:transition-none"
    >
      <DialogTitle className="sr-only">Park a thought</DialogTitle>
      <form
        aria-label="Park a thought"
        className="flex flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          park();
        }}
      >
        <div className="flex items-center gap-2.5 px-4 py-3.5">
          <InboxIcon aria-hidden className="size-4.5 shrink-0 text-muted-foreground" />
          <label htmlFor={inputId} className="sr-only">
            Thought to park
          </label>
          <input
            id={inputId}
            autoFocus
            autoComplete="off"
            value={text}
            maxLength={PARKED_INPUT_MAX_CHARS}
            aria-describedby={lengthCount ? `${inputId}-count` : undefined}
            placeholder="A thought for later"
            className="min-w-0 flex-1 bg-transparent text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void startThread();
              }
            }}
          />
          {lengthCount ? (
            <span
              id={`${inputId}-count`}
              className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums"
            >
              {lengthCount}
            </span>
          ) : null}
        </div>
        <div className="h-px bg-border" />
        <div className="flex items-center gap-2 px-3 py-2.5">
          <Menu>
            <MenuTrigger
              render={<Button type="button" size="sm" variant="ghost" className="sm:text-xs" />}
            >
              {projectTitle}
              <ChevronDownIcon aria-hidden className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="start">
              <MenuRadioGroup
                value={selectedOption?.key ?? ""}
                onValueChange={(value) => setProjectKey(value === "" ? null : String(value))}
              >
                {/* A project once picked can be cleared again. */}
                <MenuRadioItem value="" closeOnClick>
                  No project
                </MenuRadioItem>
                {projectOptions.map((option) => (
                  <MenuRadioItem key={option.key} value={option.key} closeOnClick>
                    {option.label}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuPopup>
          </Menu>
          <span className="grow" />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="sm:text-xs"
            disabled={empty || starting}
            aria-keyshortcuts={mac ? "Meta+Enter" : "Control+Enter"}
            onClick={() => void startThread()}
          >
            Start a thread instead
            <ShortcutKeyCaps label={mac ? "⌘↵" : "Ctrl+↵"} />
          </Button>
          <Button type="submit" size="sm" className="sm:text-xs" disabled={empty || starting}>
            Park
            <Kbd className="h-4 min-w-4 rounded border border-primary-foreground bg-transparent px-1 text-[11px] text-primary-foreground">
              ↵
            </Kbd>
          </Button>
        </div>
      </form>
      {/* Says how to come back without the bar, and that nothing behind it stopped. */}
      <p className="px-5 pb-3 text-xs text-muted-foreground">
        {openShortcut ? `Opens from anywhere with ${openShortcut}. ` : null}
        The thread you are in keeps going and you stay where you are.
      </p>
    </DialogPopup>
  );
}
