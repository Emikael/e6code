import { useAtomValue } from "@effect/atom-react";
import { useParams } from "@tanstack/react-router";
import { useEffect } from "react";

import { isCommandPaletteOpen } from "../commandPaletteBus";
import { useCloseFocusOpenedPanels } from "../hooks/useFocusMode";
import { resolveShortcutCommand } from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { primaryServerKeybindingsAtom } from "../state/server";
import { useUiStateStore } from "../uiStateStore";

/**
 * Root coordinator for `focus.toggle` (Mod+Alt+Z) and the desktop View menu
 * item. It lives at the root so the key and the menu also work from Settings,
 * where focus is waiting to resume. Focus starts on a thread and exits from
 * anywhere; Escape never exits it. It also closes the right panels focus
 * opened, whichever route focus ends on.
 */
export function FocusModeShortcut() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  useCloseFocusOpenedPanels();
  const onThread = useParams({
    strict: false,
    select: (params) => Boolean(params.environmentId && params.threadId),
  });

  useEffect(() => {
    const toggle = () => {
      const { focusMode, toggleFocusMode } = useUiStateStore.getState();
      if (!focusMode && !onThread) return false;
      toggleFocusMode();
      return true;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isCommandPaletteOpen()) return;
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
      if (command !== "focus.toggle") return;
      const { focusMode } = useUiStateStore.getState();
      if (!focusMode && !onThread) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    const offMenu = window.desktopBridge?.onMenuAction?.((action) => {
      if (action === "focus.toggle") toggle();
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      offMenu?.();
    };
  }, [keybindings, onThread]);

  return null;
}
