import { describe, expect, it } from "vite-plus/test";

import type { WorkspaceState } from "../../state/workspaceModel";
import {
  describeHomeConnectionLine,
  workspaceConnectionStatusPresentation,
} from "./workspace-connection-status";

function workspaceState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    isLoadingConnections: false,
    hasConnections: true,
    hasLoadedShellSnapshot: true,
    hasPendingShellSnapshot: false,
    hasReadyEnvironment: true,
    hasConnectingEnvironment: false,
    connectingEnvironments: [],
    connectionState: "connected",
    connectionError: null,
    shellSnapshotError: null,
    latestCachedSnapshotReceivedAt: null,
    networkStatus: "online",
    ...overrides,
  };
}

describe("workspace connection status", () => {
  it("stays hidden while a ready environment is connected", () => {
    expect(workspaceConnectionStatusPresentation(workspaceState())).toBeNull();
  });

  it("surfaces offline snapshots", () => {
    const state = workspaceState({ networkStatus: "offline", hasReadyEnvironment: false });

    expect(workspaceConnectionStatusPresentation(state)).toEqual({
      label: "You are offline",
      showsProgress: false,
    });
  });

  it("names the environment while reconnecting", () => {
    const state = workspaceState({
      hasConnectingEnvironment: true,
      hasReadyEnvironment: false,
      connectingEnvironments: [
        {
          environmentId: "environment-1" as never,
          environmentLabel: "Julius’s Mac mini",
          displayUrl: "",
          isRelayManaged: false,
          isEnabled: true,
          connectionState: "reconnecting",
          connectionError: null,
          connectionErrorTraceId: null,
        },
      ],
    });

    expect(workspaceConnectionStatusPresentation(state)).toEqual({
      label: "Reconnecting to Julius’s Mac mini",
      showsProgress: true,
    });
  });

  it("surfaces connection errors before the generic disconnected fallback", () => {
    const state = workspaceState({
      connectionError: "Could not reach Julius’s Mac mini",
      hasLoadedShellSnapshot: false,
      hasReadyEnvironment: false,
    });

    expect(workspaceConnectionStatusPresentation(state)).toEqual({
      label: "Could not reach Julius’s Mac mini",
      showsProgress: false,
    });
  });

  it("shows shell catch-up while cached threads remain visible", () => {
    const state = workspaceState({ hasPendingShellSnapshot: true });

    expect(workspaceConnectionStatusPresentation(state)).toEqual({
      label: "Syncing threads...",
      showsProgress: true,
    });
  });

  it("distinguishes initial shell loading from cached catch-up", () => {
    const state = workspaceState({
      hasLoadedShellSnapshot: false,
      hasPendingShellSnapshot: true,
    });

    expect(workspaceConnectionStatusPresentation(state)).toEqual({
      label: "Loading threads...",
      showsProgress: true,
    });
  });
});

describe("Home connection line", () => {
  const environment = (displayUrl: string, overrides: { isRelayManaged?: boolean } = {}) => ({
    environmentLabel: "This Mac",
    displayUrl,
    isRelayManaged: overrides.isRelayManaged ?? false,
    isEnabled: true,
    connectionState: "connected" as const,
  });

  it("names the machine and how it is reached, as board 8 does", () => {
    const line = (displayUrl: string, isRelayManaged = false) =>
      describeHomeConnectionLine({
        state: workspaceState(),
        environments: [environment(displayUrl, { isRelayManaged })],
      });
    expect(line("https://mac.tail1234.ts.net")).toBe("This Mac · connected over Tailscale");
    expect(line("100.101.2.3:3773")).toBe("This Mac · connected over Tailscale");
    expect(line("http://192.168.1.20:3773")).toBe("This Mac · connected on your local network");
    expect(line("https://e6.example.com")).toBe("This Mac · connected over the internet");
    expect(line("", true)).toBe("This Mac · connected over the relay");
  });

  it("counts several environments and names the route only when they share it", () => {
    const state = workspaceState();
    expect(
      describeHomeConnectionLine({
        state,
        environments: [environment("100.64.0.1"), environment("mac.example.ts.net")],
      }),
    ).toBe("2 environments · connected over Tailscale");
    expect(
      describeHomeConnectionLine({
        state,
        environments: [environment("100.64.0.1"), environment("192.168.0.2")],
      }),
    ).toBe("2 environments · connected");
  });

  it("says what is wrong while reconnecting, and nothing before anything connects", () => {
    expect(
      describeHomeConnectionLine({
        state: workspaceState({ networkStatus: "offline", hasReadyEnvironment: false }),
        environments: [environment("100.64.0.1")],
      }),
    ).toBe("You are offline");
    expect(describeHomeConnectionLine({ state: workspaceState(), environments: [] })).toBeNull();
  });
});
