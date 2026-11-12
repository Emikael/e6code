import { scopedProjectKey, scopeProjectRef } from "@e6tools/client-runtime/environment";
import type { EnvironmentId, ScopedProjectRef } from "@e6tools/contracts";

import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";

export interface CaptureProjectOption {
  /** `scopedProjectKey` of the member a thought parks into. */
  readonly key: string;
  /** Every member's key, so a thought parked in any of them selects this row. */
  readonly memberKeys: ReadonlyArray<string>;
  /** The group's name, with the environment added when two groups share a name. */
  readonly label: string;
}

/**
 * The capture bar's project rows: one per project group, as the sidebar and the start
 * screen list them. A row parks into the member already chosen, else the one on the
 * primary environment, else the first.
 */
export function captureProjectOptions(input: {
  readonly groups: ReadonlyArray<SidebarProjectSnapshot>;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly preferredProjectRef: ScopedProjectRef | null;
}): CaptureProjectOption[] {
  const nameCounts = new Map<string, number>();
  for (const group of input.groups) {
    nameCounts.set(group.displayName, (nameCounts.get(group.displayName) ?? 0) + 1);
  }
  const preferred = input.preferredProjectRef;
  return input.groups.flatMap((group) => {
    const target =
      (preferred &&
        group.memberProjects.find(
          (member) =>
            member.environmentId === preferred.environmentId && member.id === preferred.projectId,
        )) ||
      group.memberProjects.find((member) => member.environmentId === input.primaryEnvironmentId) ||
      group.memberProjects[0];
    if (!target) return [];
    const environmentLabel =
      (nameCounts.get(group.displayName) ?? 0) > 1 ? target.environmentLabel : null;
    return [
      {
        key: scopedProjectKey(scopeProjectRef(target.environmentId, target.id)),
        memberKeys: group.memberProjects.map((member) =>
          scopedProjectKey(scopeProjectRef(member.environmentId, member.id)),
        ),
        label: environmentLabel ? `${group.displayName} · ${environmentLabel}` : group.displayName,
      },
    ];
  });
}
