import { CommandId } from "@e6tools/contracts";
import { squashAtomCommandFailure } from "@e6tools/client-runtime/state/runtime";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";
import {
  waitForThreadWorkspaceOperation,
  type ThreadWorkspaceSnapshot,
} from "./thread-workspace-operation";

const commandId = CommandId.make("select-workspace");
const original: ThreadWorkspaceSnapshot = {
  branch: "main",
  worktreePath: null,
  workspaceGeneration: 0,
};
const selection = { kind: "branch" as const, branch: "feature" };

describe("confirmed thread workspace selection", () => {
  it("waits through an ACK and unrelated projection until the matching operation completes", async () => {
    const registry = AtomRegistry.make();
    const atom = Atom.make<ThreadWorkspaceSnapshot | null>(original);
    const result = waitForThreadWorkspaceOperation({
      registry,
      atom,
      commandId,
      expectedGeneration: 0,
    });
    let resolved = false;
    void result.then(() => {
      resolved = true;
    });
    registry.set(atom, {
      ...original,
      workspaceOperation: {
        commandId: CommandId.make("older-command"),
        selection,
        status: "completed",
      },
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    registry.set(atom, {
      ...original,
      workspaceOperation: { commandId, selection, status: "pending" },
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    registry.set(atom, {
      branch: "feature",
      worktreePath: "/worktrees/feature",
      workspaceGeneration: 1,
      workspaceOperation: { commandId, selection, status: "completed" },
    });
    const completed = await result;
    expect(completed._tag).toBe("Success");
    if (completed._tag === "Success")
      expect(completed.value.worktreePath).toBe("/worktrees/feature");
    registry.dispose();
  });

  it("reports failure without adopting a proposed branch", async () => {
    const registry = AtomRegistry.make();
    const atom = Atom.make<ThreadWorkspaceSnapshot | null>(original);
    const result = waitForThreadWorkspaceOperation({
      registry,
      atom,
      commandId,
      expectedGeneration: 0,
    });
    registry.set(atom, {
      ...original,
      workspaceOperation: { commandId, selection, status: "failed", error: "Branch is occupied" },
    });
    const failed = await result;
    expect(failed._tag).toBe("Failure");
    if (failed._tag === "Failure")
      expect(String(squashAtomCommandFailure(failed))).toContain("Branch is occupied");
    expect(registry.get(atom)?.branch).toBe("main");
    registry.dispose();
  });

  it("rejects a superseding binding instead of using another operation's workspace", async () => {
    const registry = AtomRegistry.make();
    const atom = Atom.make<ThreadWorkspaceSnapshot | null>(original);
    const result = waitForThreadWorkspaceOperation({
      registry,
      atom,
      commandId,
      expectedGeneration: 0,
    });
    registry.set(atom, {
      branch: "another",
      worktreePath: "/worktrees/another",
      workspaceGeneration: 2,
      workspaceOperation: {
        commandId: CommandId.make("another-command"),
        selection,
        status: "completed",
      },
    });
    expect((await result)._tag).toBe("Failure");
    registry.dispose();
  });
});
