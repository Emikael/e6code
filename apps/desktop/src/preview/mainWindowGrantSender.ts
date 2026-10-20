import type { DesktopIpcInvokeEvent } from "../ipc/DesktopIpc.ts";

/**
 * Grant, deny, and prompt IPC may only come from the desktop window's main
 * frame. Preview guests run with context isolation off and a preload that can
 * see `ipcRenderer`, so a page script must not be able to approve itself.
 */
export function isMainWindowGrantSender(
  event: DesktopIpcInvokeEvent | undefined,
  main:
    | {
        readonly id: number;
        readonly getType?: () => string;
        readonly mainFrame?: { readonly frameTreeNodeId: number } | null;
      }
    | null
    | undefined,
): boolean {
  if (event === undefined || main == null) return false;
  if (event.sender.getType?.() !== "window") return false;
  if (main.getType !== undefined && main.getType() !== "window") return false;
  if (event.sender.id !== main.id) return false;
  const senderFrameId = event.senderFrame?.frameTreeNodeId;
  const mainFrameId = main.mainFrame?.frameTreeNodeId;
  return senderFrameId !== undefined && mainFrameId !== undefined && senderFrameId === mainFrameId;
}
