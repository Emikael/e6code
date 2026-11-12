import { EnvironmentId, ProjectId } from "@e6tools/contracts";
import { scopeProjectRef } from "@e6tools/client-runtime/environment";
import { describe, expect, it } from "vite-plus/test";

import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import { captureProjectOptions } from "./CaptureBar.logic";

const laptop = EnvironmentId.make("laptop");
const server = EnvironmentId.make("server");

function group(
  displayName: string,
  members: ReadonlyArray<{ environmentId: EnvironmentId; id: string; label: string }>,
): SidebarProjectSnapshot {
  const memberProjects = members.map((member) => ({
    environmentId: member.environmentId,
    id: ProjectId.make(member.id),
    environmentLabel: member.label,
  }));
  return { displayName, memberProjects } as unknown as SidebarProjectSnapshot;
}

describe("captureProjectOptions", () => {
  it("lists one row per group, parking into the primary member", () => {
    const options = captureProjectOptions({
      groups: [
        group("e6code", [
          { environmentId: server, id: "p-server", label: "Server" },
          { environmentId: laptop, id: "p-laptop", label: "This Mac" },
        ]),
      ],
      primaryEnvironmentId: laptop,
      preferredProjectRef: null,
    });
    expect(options).toEqual([
      {
        key: "laptop:p-laptop",
        memberKeys: ["server:p-server", "laptop:p-laptop"],
        label: "e6code",
      },
    ]);
  });

  it("keeps the member already chosen", () => {
    const [option] = captureProjectOptions({
      groups: [
        group("e6code", [
          { environmentId: server, id: "p-server", label: "Server" },
          { environmentId: laptop, id: "p-laptop", label: "This Mac" },
        ]),
      ],
      primaryEnvironmentId: laptop,
      preferredProjectRef: scopeProjectRef(server, ProjectId.make("p-server")),
    });
    expect(option?.key).toBe("server:p-server");
  });

  it("names the environment only when two rows share a title", () => {
    const options = captureProjectOptions({
      groups: [
        group("site", [{ environmentId: laptop, id: "a", label: "This Mac" }]),
        group("site", [{ environmentId: server, id: "b", label: "Server" }]),
        group("e6code", [{ environmentId: laptop, id: "c", label: "This Mac" }]),
      ],
      primaryEnvironmentId: laptop,
      preferredProjectRef: null,
    });
    expect(options.map((option) => option.label)).toEqual([
      "site · This Mac",
      "site · Server",
      "e6code",
    ]);
  });
});
