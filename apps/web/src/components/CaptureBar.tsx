/**
 * Park a thought (board 4, F7): one line, from anywhere, and you stay where
 * you are. Enter parks it, Mod+Enter starts a thread with it instead, Escape
 * closes. Mod+Alt+P opens it; Mod+S stays the composer's own "park this
 * draft" (decision 8).
 */
import { useAtomValue } from "@effect/atom-react";
import { scopedProjectKey, scopeProjectRef } from "@e6tools/client-runtime/environment";
import { ChevronDownIcon, InboxIcon } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { isCommandPaletteOpen } from "../commandPaletteBus";
import { useParkedActions } from "../hooks/useParkedActions";
import { isMacPlatform } from "@e6tools/shared/keybindings";
import { resolveShortcutCommand } from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { parkThought, useCaptureBarStore } from "../parkedThoughts";
import { usePromptStashStore } from "../promptStashStore";
import { useProjects } from "../state/entities";
import { primaryServerKeybindingsAtom } from "../state/server";
import { Button } from "./ui/button";
import { Dialog, DialogPopup, DialogTitle } from "./ui/dialog";
import { Kbd } from "./ui/kbd";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/menu";
import { toastManager } from "./ui/toast";

/** Root coordinator: the Mod+Alt+P listener and the one capture bar. */
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
    <Dialog open={open} onOpenChange={setOpen}>
      {open ? <CaptureBar onClose={() => setOpen(false)} /> : null}
    </Dialog>
  );
}

function CaptureBar({ onClose }: { onClose: () => void }) {
  const { startThreadWith, currentProjectKey } = useParkedActions();
  const projects = useProjects();
  const inputId = useId();
  const [text, setText] = useState("");
  // The project on screen when it opened; the thought keeps it.
  const [projectKey, setProjectKey] = useState<string | null>(() => currentProjectKey());
  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        key: scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
        title: project.title,
      })),
    [projects],
  );
  const projectTitle =
    projectOptions.find((option) => option.key === projectKey)?.title ?? "No project";
  const empty = text.trim().length === 0;

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

  const startThread = async () => {
    if (empty) return;
    onClose();
    if (!(await startThreadWith(text.trim(), projectKey))) {
      // Nothing was lost: park it instead and say so.
      const result = parkThought(text, projectKey);
      toastManager.add({
        type: "error",
        title: "Could not start a thread",
        description:
          result.kind === "parked" ? "The thought was parked instead." : "Add a project first.",
      });
    }
  };

  return (
    <DialogPopup
      showCloseButton={false}
      bottomStickOnMobile={false}
      viewportClassName="grid-rows-[0.6fr_auto_1fr]"
      className="max-w-110 overflow-hidden rounded-xl"
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
        </div>
        <div className="h-px bg-border" />
        <div className="flex items-center gap-2 px-3 py-2.5">
          <Menu>
            <MenuTrigger render={<Button type="button" size="sm" variant="ghost" />}>
              {projectTitle}
              <ChevronDownIcon aria-hidden className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="start">
              <MenuRadioGroup
                value={projectKey ?? ""}
                onValueChange={(value) => setProjectKey(value === "" ? null : String(value))}
              >
                {projectOptions.map((option) => (
                  <MenuRadioItem key={option.key} value={option.key} closeOnClick>
                    {option.title}
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
            disabled={empty}
            onClick={() => void startThread()}
          >
            Start a thread instead
            <ShortcutHint label={isMacPlatform(navigator.platform) ? "⌘↵" : "Ctrl+↵"} />
          </Button>
          <Button type="submit" size="sm" disabled={empty}>
            Park
            <Kbd className="h-4 min-w-4 bg-transparent px-1 text-primary-foreground ring-1 ring-primary-foreground">
              ↵
            </Kbd>
          </Button>
        </div>
      </form>
    </DialogPopup>
  );
}

function ShortcutHint({ label }: { label: string }) {
  return <Kbd className="h-5 bg-transparent px-1 ring-1 ring-border">{label}</Kbd>;
}
