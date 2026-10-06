import { CommandId, EnvironmentId, ProjectId, ThreadId } from "@e6tools/contracts";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ThreadShell } from "../types";

const dispatch = vi.hoisted(() => vi.fn());
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => dispatch }));
vi.mock("../state/threads", () => ({ threadEnvironment: { selectWorkspace: {} } }));
import { useThreadWorkspaceSelection } from "./useThreadWorkspaceSelection";

function shell(environmentId = EnvironmentId.make("environment-a")): ThreadShell {
  return {
    id: ThreadId.make("same-id"),
    environmentId,
    projectId: ProjectId.make("project"),
    branch: "main",
    worktreePath: null,
    workspaceGeneration: 0,
  } as ThreadShell;
}

describe("workspace selection lifecycle", () => {
  let renderer: ReactTestRenderer | undefined;
  let current: ReturnType<typeof useThreadWorkspaceSelection>;
  function Harness(props: { thread: ThreadShell; supportsSelection: boolean }) {
    current = useThreadWorkspaceSelection(props);
    return null;
  }
  const render = async (thread: ThreadShell, supportsSelection = true) => {
    await act(async () => {
      if (renderer) renderer.update(createElement(Harness, { thread, supportsSelection }));
      else renderer = create(createElement(Harness, { thread, supportsSelection }));
    });
  };
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    dispatch.mockReset();
  });
  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
  });

  it("blocks sends immediately, through ACK, until the matching binding is confirmed", async () => {
    let acknowledge!: (value: unknown) => void;
    dispatch.mockImplementation(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const thread = shell();
    await render(thread);
    let selection!: Promise<void>;
    await act(async () => {
      selection = current.selectWorkspace({ kind: "branch", branch: "feature/a" });
    });
    expect(current.pending).toBe(true);
    const request = dispatch.mock.calls[0]![0];
    await act(async () => {
      acknowledge({ _tag: "Success", value: { sequence: 1, commandId: request.input.commandId } });
      await selection;
    });
    expect(current.pending).toBe(true);
    expect(thread.branch).toBe("main");
    await render({
      ...thread,
      branch: "feature/a",
      workspaceGeneration: 1,
      workspaceOperation: {
        commandId: request.input.commandId,
        selection: request.input.selection,
        status: "completed",
      },
    });
    expect(current.pending).toBe(false);
  });

  it("does not carry pending state or late responses into the same id on another environment", async () => {
    let acknowledge!: (value: unknown) => void;
    dispatch.mockImplementation(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    await render(shell());
    let selection!: Promise<void>;
    await act(async () => {
      selection = current.selectWorkspace({ kind: "branch", branch: "feature/a" });
    });
    const request = dispatch.mock.calls[0]![0];
    await render(shell(EnvironmentId.make("environment-b")));
    expect(current.pending).toBe(false);
    await act(async () => {
      acknowledge({ _tag: "Success", value: { sequence: 1, commandId: request.input.commandId } });
      await selection;
    });
    expect(current.pending).toBe(false);
    await render(shell());
    expect(current.pending).toBe(true);
  });

  it("honors an operation started by another client and capability gating", async () => {
    await render({
      ...shell(),
      workspaceOperation: {
        commandId: CommandId.make("remote"),
        status: "pending",
        selection: { kind: "branch", branch: "feature/remote" },
      },
    });
    expect(current.pending).toBe(true);
    await act(async () => {
      await current.selectWorkspace({ kind: "branch", branch: "feature/a" });
    });
    expect(dispatch).not.toHaveBeenCalled();
    await render(shell(), false);
    await act(async () => {
      await current.selectWorkspace({ kind: "branch", branch: "feature/a" });
    });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
