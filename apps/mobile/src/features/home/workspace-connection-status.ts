import { isLocalLoopbackHost, isPrivateNetworkHost } from "@e6tools/shared/hostClassification";

import type { WorkspaceEnvironment, WorkspaceState } from "../../state/workspaceModel";

export interface WorkspaceConnectionStatusPresentation {
  readonly label: string;
  /** True while actively working (connecting/syncing) — render a spinner. False for offline/error/idle states — render a wifi-slash icon. */
  readonly showsProgress: boolean;
}

function shouldShowWorkspaceConnectionStatus(state: WorkspaceState): boolean {
  return (
    state.networkStatus === "offline" ||
    state.connectionError !== null ||
    state.hasConnectingEnvironment ||
    state.hasPendingShellSnapshot ||
    (state.hasLoadedShellSnapshot && !state.hasReadyEnvironment)
  );
}

function workspaceConnectionStatusLabel(state: WorkspaceState): string {
  if (state.networkStatus === "offline") return "You are offline";
  if (state.connectingEnvironments.length === 1) {
    return `Reconnecting to ${state.connectingEnvironments[0]!.environmentLabel}`;
  }
  if (state.connectingEnvironments.length > 1) {
    return `Reconnecting ${state.connectingEnvironments.length} environments`;
  }
  if (state.connectionError !== null) return state.connectionError;
  if (state.hasPendingShellSnapshot) {
    return state.hasLoadedShellSnapshot ? "Syncing threads..." : "Loading threads...";
  }
  return "Not connected";
}

/** Header-title presentation of the connection state, or null while connected. */
export function workspaceConnectionStatusPresentation(
  state: WorkspaceState,
): WorkspaceConnectionStatusPresentation | null {
  if (!shouldShowWorkspaceConnectionStatus(state)) return null;
  return {
    label: workspaceConnectionStatusLabel(state),
    showsProgress:
      state.networkStatus !== "offline" &&
      state.connectionError === null &&
      (state.connectingEnvironments.length > 0 || state.hasPendingShellSnapshot),
  };
}

type ConnectionLineEnvironment = Pick<
  WorkspaceEnvironment,
  "environmentLabel" | "displayUrl" | "isRelayManaged" | "isEnabled" | "connectionState"
>;

function hostOf(displayUrl: string): string | null {
  try {
    return new URL(displayUrl.includes("://") ? displayUrl : `http://${displayUrl}`).hostname;
  } catch {
    return null;
  }
}

/** How an environment is reached, in words: "over Tailscale", "on your local network". */
function connectionRoute(environment: ConnectionLineEnvironment): string | null {
  if (environment.isRelayManaged) return "over the relay";
  const host = hostOf(environment.displayUrl);
  if (host === null) return null;
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  const octets = normalized.split(".").map(Number);
  const tailnetAddress =
    octets.length === 4 && octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127;
  if (normalized.endsWith(".ts.net") || tailnetAddress) return "over Tailscale";
  if (isLocalLoopbackHost(normalized)) return "on this device";
  if (isPrivateNetworkHost(normalized)) return "on your local network";
  return "over the internet";
}

/**
 * The line under Home's title (board 8): "This Mac · connected over
 * Tailscale". While anything is offline or reconnecting it says that
 * instead, in the words the title slot used to show; null with nothing
 * connected yet.
 */
export function describeHomeConnectionLine(input: {
  readonly state: WorkspaceState;
  readonly environments: ReadonlyArray<ConnectionLineEnvironment>;
}): string | null {
  const status = workspaceConnectionStatusPresentation(input.state);
  if (status !== null) return status.label;
  const connected = input.environments.filter(
    (environment) => environment.isEnabled && environment.connectionState === "connected",
  );
  if (connected.length === 0) return null;
  const routes = new Set(connected.map(connectionRoute));
  const route = routes.size === 1 ? [...routes][0] : null;
  const who =
    connected.length === 1 ? connected[0]!.environmentLabel : `${connected.length} environments`;
  return route ? `${who} · connected ${route}` : `${who} · connected`;
}
