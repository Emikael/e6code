import type { DeviceSummary } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deviceListGroups } from "./deviceListRows";

function device(id: string, platform: "ios" | "android", booted: boolean): DeviceSummary {
  return {
    hostId: "mac",
    id,
    platform,
    name: id,
    version: platform === "ios" ? "iOS 18.2" : "Android 15",
    booted,
    physical: false,
  };
}

describe("the device list", () => {
  it("groups by platform, running first, with one outlined Open and Cancel while starting", () => {
    const groups = deviceListGroups(
      [
        device("iPhone SE", "ios", false),
        device("iPhone 16", "ios", true),
        device("Pixel 8", "android", false),
        device("Pixel 9", "android", true),
      ],
      [device("Pixel 8", "android", false)],
      [device("Pixel 8", "android", false)],
    );
    expect(groups.map((group) => group.label)).toEqual(["iOS simulators", "Android emulators"]);
    expect(
      groups.flatMap((group) =>
        group.rows.map((row) => `${row.device.name}:${row.state}:${row.primary}`),
      ),
    ).toEqual([
      "iPhone 16:running:true",
      "iPhone SE:off:false",
      "Pixel 9:running:false",
      "Pixel 8:starting:false",
    ]);
  });

  it("offers Cancel only for a start this client asked for", () => {
    const groups = deviceListGroups(
      [device("Pixel 8", "android", false), device("Pixel 9", "android", false)],
      [device("Pixel 8", "android", false), device("Pixel 9", "android", false)],
      [device("Pixel 9", "android", false)],
    );
    expect(groups[0]!.rows.map((row) => `${row.device.name}:${row.state}`)).toEqual([
      "Pixel 8:starting-elsewhere",
      "Pixel 9:starting",
    ]);
  });
});
