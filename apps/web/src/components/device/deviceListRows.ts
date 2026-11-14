import type { DevicePlatform, DeviceSummary } from "@e6tools/contracts";

/**
 * A row's state word and its one button: Open when running, Start when off, Cancel while
 * starting. Cancel is only for a start this client asked for in this thread; a device another
 * thread or client is starting reads "Starting" with no button, since cancelling it would undo
 * someone else's work.
 */
export type DeviceRowState = "running" | "off" | "starting" | "starting-elsewhere";

export const DEVICE_ROW_STATE: Record<
  DeviceRowState,
  { readonly word: string; readonly action: "Open" | "Start" | "Cancel" | null }
> = {
  running: { word: "Running", action: "Open" },
  off: { word: "Off", action: "Start" },
  starting: { word: "Starting", action: "Cancel" },
  "starting-elsewhere": { word: "Starting", action: null },
};

export interface DeviceListGroup {
  readonly platform: DevicePlatform;
  readonly label: string;
  readonly rows: ReadonlyArray<{
    readonly device: DeviceSummary;
    readonly state: DeviceRowState;
    /** The list's first Open is its one outlined button. */
    readonly primary: boolean;
  }>;
}

const deviceKey = (device: Pick<DeviceSummary, "hostId" | "id">) =>
  `${device.hostId}\u0000${device.id}`;

/**
 * Board 18's device list: grouped by platform, running devices first, each with its state.
 * `starting` holds the devices the server says are booting, for anyone; `startedHere` the ones
 * this client is starting for this thread, which alone can be cancelled.
 */
export function deviceListGroups(
  devices: ReadonlyArray<DeviceSummary>,
  starting: ReadonlyArray<Pick<DeviceSummary, "hostId" | "id">>,
  startedHere: ReadonlyArray<Pick<DeviceSummary, "hostId" | "id">> = [],
): DeviceListGroup[] {
  const startingKeys = new Set(starting.map(deviceKey));
  const startedHereKeys = new Set(startedHere.map(deviceKey));
  let primaryTaken = false;
  const groups: DeviceListGroup[] = [];
  for (const platform of ["ios", "android"] as const) {
    const sorted = devices
      .filter((device) => device.platform === platform)
      .toSorted((a, b) => Number(b.booted) - Number(a.booted) || a.name.localeCompare(b.name));
    if (sorted.length === 0) continue;
    groups.push({
      platform,
      label: platform === "ios" ? "iOS simulators" : "Android emulators",
      rows: sorted.map((device) => {
        const key = deviceKey(device);
        const state: DeviceRowState = startedHereKeys.has(key)
          ? "starting"
          : startingKeys.has(key)
            ? "starting-elsewhere"
            : device.booted
              ? "running"
              : "off";
        const primary = state === "running" && !primaryTaken;
        if (primary) primaryTaken = true;
        return { device, state, primary };
      }),
    });
  }
  return groups;
}
