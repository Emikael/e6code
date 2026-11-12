import type { DiscoveredLocalServer, ScopedThreadRef } from "@e6tools/contracts";
import {
  mapAtomCommandResult,
  type AtomCommandResult,
} from "@e6tools/client-runtime/state/runtime";

import { resolveDiscoveredServerUrl } from "~/browser/browserTargetResolver";
import type { BrowserSettingsReadError, OpenPreviewMutation } from "~/browser/openFileInPreview";
import { recordVisitForThread } from "~/browserHistoryStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { openPreviewSession } from "./openPreviewSession";

export async function openDiscoveredPort<E>(input: {
  readonly threadRef: ScopedThreadRef;
  readonly port: DiscoveredLocalServer;
  readonly openPreview: OpenPreviewMutation<E>;
}): Promise<AtomCommandResult<void, E | BrowserSettingsReadError>> {
  return openLocalAddressInBrowser({
    threadRef: input.threadRef,
    url: input.port.url,
    resolvedUrl: resolveDiscoveredServerUrl(input.threadRef.environmentId, input.port.url),
    openPreview: input.openPreview,
  });
}

/**
 * Opens a local address in the thread's Browser tab. `resolvedUrl` is where this client
 * reaches it (see `resolveLocalServerUrl`); history records the address as the server printed it.
 */
export async function openLocalAddressInBrowser<E>(input: {
  readonly threadRef: ScopedThreadRef;
  readonly url: string;
  readonly resolvedUrl: string;
  readonly openPreview: OpenPreviewMutation<E>;
}): Promise<AtomCommandResult<void, E | BrowserSettingsReadError>> {
  const result = await openPreviewSession({
    openPreview: input.openPreview,
    threadRef: input.threadRef,
    url: input.resolvedUrl,
  });
  return mapAtomCommandResult(result, (snapshot) => {
    recordVisitForThread(input.threadRef, input.url);
    useRightPanelStore.getState().openBrowser(input.threadRef, snapshot.tabId);
  });
}
