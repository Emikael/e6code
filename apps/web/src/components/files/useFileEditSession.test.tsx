import { EnvironmentId } from "@e6tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { writeFile, files, disk } = vi.hoisted(() => ({
  writeFile: vi.fn(),
  files: new Map<string, string>(),
  disk: { contents: "v0" },
}));
vi.mock("~/state/projects", () => ({ projectEnvironment: { writeFile: {} } }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => writeFile }));
vi.mock("./projectFilesQueryState", () => ({
  confirmProjectFileQueryData: vi.fn(),
  clearProjectFileQueryData: (_e: unknown, _c: string, path: string) => files.delete(path),
  getOptimisticProjectFileQueryData: (_e: unknown, _c: string, path: string) =>
    files.has(path) ? { contents: files.get(path) } : null,
  setProjectFileQueryData: (_e: unknown, _c: string, path: string, contents: string) =>
    files.set(path, contents),
  readProjectFileFromDisk: async () => disk.contents,
}));

import { useFileEditStore } from "./fileEditStore";
import { type FileEditSession, useFileEditSession } from "./useFileEditSession";

const environmentId = EnvironmentId.make("file-edit-session");
const onPendingChange = vi.fn();
let renderer: ReactTestRenderer | null;
let session: FileEditSession;

interface Props {
  readonly relativePath: string | null;
  readonly turnKey: string;
}

function Surface(props: Props) {
  session = useFileEditSession({
    environmentId,
    cwd: "/workspace",
    threadKey: "thread-1",
    relativePath: props.relativePath,
    contents: props.relativePath === null ? null : (files.get(props.relativePath) ?? disk.contents),
    serverContents: props.relativePath === null ? null : disk.contents,
    turnKey: props.turnKey,
    onPendingChange,
  });
  return null;
}

function render(props: Props) {
  act(() => {
    if (renderer) renderer.update(<Surface {...props} />);
    else renderer = create(<Surface {...props} />);
  });
}

beforeEach(() => {
  renderer = null;
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  writeFile.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  files.clear();
  disk.contents = "v0";
  useFileEditStore.setState({ byFileKey: {} });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("editing a file in the Files tab", () => {
  it("keeps the editor's handler and a pending save when a turn starts", async () => {
    render({ relativePath: "a.ts", turnKey: "turn-1" });
    const edit = session.edit;
    edit("v1");
    render({ relativePath: "a.ts", turnKey: "turn-2" });
    expect(session.edit).toBe(edit);
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(writeFile).toHaveBeenCalledOnce();
  });

  it("keeps Revert after the reader opens another file and comes back", async () => {
    render({ relativePath: "a.ts", turnKey: "turn-1" });
    session.edit("v1");
    disk.contents = "v0";
    await act(() => vi.advanceTimersByTimeAsync(500));
    disk.contents = "v1";
    render({ relativePath: "b.ts", turnKey: "turn-1" });
    render({ relativePath: "a.ts", turnKey: "turn-1" });
    expect(session.canRevert).toBe(true);
    render({ relativePath: "a.ts", turnKey: "turn-2" });
    expect(session.canRevert).toBe(false);
  });

  it("brings a held edit back, with its notice, after the reader leaves the file", async () => {
    render({ relativePath: "a.ts", turnKey: "turn-1" });
    session.edit("mine");
    disk.contents = "theirs";
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(session.history.conflict).toBe("theirs");
    expect(writeFile).not.toHaveBeenCalled();

    render({ relativePath: "b.ts", turnKey: "turn-1" });
    files.delete("a.ts");
    render({ relativePath: "a.ts", turnKey: "turn-1" });
    expect(files.get("a.ts")).toBe("mine");
    expect(session.history.conflict).toBe("theirs");

    act(() => session.keepMine());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { cwd: "/workspace", relativePath: "a.ts", contents: "mine" },
    });
  });

  it("keeps the reader's save when the agent wrote over it while they were not editing", async () => {
    render({ relativePath: "a.ts", turnKey: "turn-1" });
    session.edit("mine");
    await act(() => vi.advanceTimersByTimeAsync(500));
    files.delete("a.ts");
    disk.contents = "theirs";
    render({ relativePath: "a.ts", turnKey: "turn-1" });
    expect(session.history.conflict).toBe("theirs");

    act(() => session.keepMine());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(writeFile).toHaveBeenLastCalledWith({
      environmentId,
      input: { cwd: "/workspace", relativePath: "a.ts", contents: "mine" },
    });
    expect(session.history.conflict).toBeNull();
    // Undo now brings back the agent's version, not the file from before either change.
    expect(session.history.undoTo).toBe("theirs");
  });

  it.each([
    ["undo", "v1"],
    ["revert", "v0"],
  ] as const)("writes the %s target over a held save", async (action, expected) => {
    render({ relativePath: "a.ts", turnKey: "turn-1" });
    session.edit("v1");
    await act(() => vi.advanceTimersByTimeAsync(500));
    disk.contents = "v1";
    render({ relativePath: "a.ts", turnKey: "turn-1" });
    session.edit("v2");
    disk.contents = "theirs";
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(session.history.conflict).toBe("theirs");
    expect(writeFile).toHaveBeenCalledOnce();

    act(() => (action === "undo" ? session.undo() : session.revert()));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(writeFile).toHaveBeenLastCalledWith({
      environmentId,
      input: { cwd: "/workspace", relativePath: "a.ts", contents: expected },
    });
    expect(session.history.conflict).toBeNull();
  });

  it("keeps the reader's text as an Undo step when they take the agent's version", async () => {
    render({ relativePath: "a.ts", turnKey: "turn-1" });
    session.edit("mine");
    disk.contents = "theirs";
    await act(() => vi.advanceTimersByTimeAsync(500));
    act(() => session.takeTheirs());
    expect(files.has("a.ts")).toBe(false);
    expect(session.canUndo).toBe(true);
    act(() => session.undo());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(writeFile).toHaveBeenLastCalledWith({
      environmentId,
      input: { cwd: "/workspace", relativePath: "a.ts", contents: "mine" },
    });
  });
});
