import type { ResolvedKeybindingsConfig, ScopedThreadRef } from "@e6tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@e6tools/shared/keybindings";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  keybindings: [] as ResolvedKeybindingsConfig,
  params: {} as Record<string, string>,
  paletteOpen: false,
  workspaceAvailable: true,
  shellStatus: "live",
  navigate: vi.fn(),
  openPreview: vi.fn(),
  setShortcuts: vi.fn(async () => undefined),
  toast: vi.fn(),
}));

vi.mock("./preview/openPreviewSession", () => ({ openPreviewSession: state.openPreview }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.keybindings }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => state.navigate,
  useParams: () => state.params,
}));
vi.mock("../state/server", () => ({ primaryServerKeybindingsAtom: {} }));
vi.mock("../state/preview", () => ({ previewEnvironment: { open: state.openPreview } }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("../state/shell", () => ({ environmentShell: { stateValueAtom: () => ({}) } }));
vi.mock("../connection/catalog", () => ({ environmentCatalog: { catalogValueAtom: "catalog" } }));
vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: (atom: unknown) =>
      atom === "catalog"
        ? { isReady: true, entries: new Map([["remote", {}]]) }
        : { status: state.shellStatus },
  },
}));
vi.mock("../state/entities", () => ({
  readThreadShell: () => ({ projectId: "project-1", worktreePath: null }),
  readProject: () => (state.workspaceAvailable ? { workspaceRoot: "/work/project" } : null),
}));
vi.mock("../composerDraftStore", () => {
  const store = {
    getDraftSession: () => null,
    getDraftThreadByRef: () => null,
    getDraftIdByRef: () => null,
  };
  return {
    useComposerDraftStore: Object.assign(
      (select: (value: typeof store) => unknown) => select(store),
      { getState: () => store },
    ),
  };
});
vi.mock("../commandPaletteBus", () => ({
  isCommandPaletteOpen: () => state.paletteOpen,
  onReopenClosedViewRequest: () => () => undefined,
}));
vi.mock("../lib/editableFocus", () => ({ isEditableFocused: () => false }));
vi.mock("../lib/previewFocus", () => ({ isPreviewFocused: () => false }));
vi.mock("../lib/terminalFocus", () => ({ isTerminalFocused: () => false }));
vi.mock("../modelPickerVisibility", () => ({ isModelPickerOpen: () => false }));
vi.mock("./ui/toast", () => ({ toastManager: { add: state.toast } }));

import { useClosedViewStore } from "../closedViewStore";
import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { ReopenClosedViewShortcut } from "./ReopenClosedViewShortcut";

const ref = { environmentId: "remote", threadId: "thread-1" } as ScopedThreadRef;
const snapshot = {
  threadId: ref.threadId,
  tabId: "closed-tab",
  navStatus: { _tag: "Success", url: "https://example.com", title: "Example" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-09-22T12:00:00.000Z",
} as const;
class TestElement extends EventTarget {
  closest(selector: string) {
    return selector === "[data-keybinding-capture]" ? this : null;
  }
}
let renderer: ReactTestRenderer | undefined;
let menuAction: ((action: string) => void) | undefined;

async function render() {
  await act(() => {
    renderer = create(<ReopenClosedViewShortcut />);
  });
}

function press(overrides: Record<string, unknown> = {}) {
  const event = Object.assign(new Event("keydown", { cancelable: true }), {
    key: "T",
    ctrlKey: true,
    metaKey: false,
    shiftKey: true,
    altKey: false,
    repeat: false,
    ...overrides,
  });
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, {
    keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
    params: {},
    paletteOpen: false,
    workspaceAvailable: true,
    shellStatus: "live",
  });
  state.navigate.mockResolvedValue(undefined);
  state.openPreview.mockReset();
  useClosedViewStore.setState({ entries: [] });
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
  useTerminalUiStateStore.setState({
    terminalUiStateByThreadKey: {},
    suppressedTerminalIdsByThreadKey: {},
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("HTMLElement", TestElement);
  vi.stubGlobal("navigator", { platform: "Linux" });
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      desktopBridge: {
        preview: { setForwardedShortcuts: state.setShortcuts },
        onMenuAction: (listener: typeof menuAction) => {
          menuAction = listener;
          return () => {
            menuAction = undefined;
          };
        },
      },
    }),
  );
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("root reopen shortcut", () => {
  it("restores a tab from settings to its owning remote thread", async () => {
    useClosedViewStore
      .getState()
      .remember({ kind: "panel-tab", threadRef: ref, surface: { kind: "diff", id: "diff" } });
    await render();
    await act(() => {
      expect(press().defaultPrevented).toBe(true);
    });
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).activeSurfaceId,
    ).toBe("diff");
    expect(state.navigate).toHaveBeenCalledWith({ to: "/$environmentId/$threadId", params: ref });
    expect(useClosedViewStore.getState().entries).toEqual([]);
  });

  it("leaves native shortcuts alone without history or while the palette is open", async () => {
    await render();
    expect(press().defaultPrevented).toBe(false);
    await act(() => {
      useClosedViewStore
        .getState()
        .remember({ kind: "panel-tab", threadRef: ref, surface: { kind: "diff", id: "diff" } });
    });
    state.paletteOpen = true;
    expect(press().defaultPrevented).toBe(false);
    expect(state.navigate).not.toHaveBeenCalled();
    expect(useClosedViewStore.getState().entries).toHaveLength(1);
  });

  it("lets the keybinding recorder capture the chord", async () => {
    useClosedViewStore
      .getState()
      .remember({ kind: "panel-tab", threadRef: ref, surface: { kind: "diff", id: "diff" } });
    await render();
    const recorder = new TestElement();
    const event = Object.assign(new Event("keydown", { bubbles: true, cancelable: true }), {
      key: "T",
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
      altKey: false,
      repeat: false,
    });
    Object.defineProperty(event, "target", { value: recorder });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(useClosedViewStore.getState().entries).toHaveLength(1);
  });

  it("serializes deliberate presses while a browser restore waits for RPC", async () => {
    useClosedViewStore
      .getState()
      .remember({ kind: "panel-tab", threadRef: ref, surface: { kind: "files", id: "files" } });
    useClosedViewStore.getState().remember({ kind: "browser", threadRef: ref, snapshot });
    let finish!: (value: ReturnType<typeof AsyncResult.success>) => void;
    state.openPreview.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await render();
    await act(() => {
      press();
      press();
    });
    expect(state.openPreview).toHaveBeenCalledTimes(1);
    expect(state.navigate).not.toHaveBeenCalled();
    await act(() => {
      finish(AsyncResult.success({ tabId: "new-tab" }));
    });
    expect(state.navigate).toHaveBeenCalledTimes(2);
    expect(useClosedViewStore.getState().entries).toEqual([]);
  });

  it("does not create a second browser when navigation fails after restoring it", async () => {
    const store = useClosedViewStore.getState();
    const older = store.remember({
      kind: "panel-tab",
      threadRef: ref,
      surface: { kind: "diff", id: "diff" },
    });
    store.remember({ kind: "browser", threadRef: ref, snapshot });
    state.openPreview.mockResolvedValue(AsyncResult.success({ tabId: "new-tab" }));
    state.navigate.mockRejectedValueOnce(new Error("navigation failed"));
    await render();
    await act(() => {
      press();
    });
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).activeSurfaceId,
    ).toBe("browser:new-tab");
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Could not reopen view" }),
    );
    expect(useClosedViewStore.getState().entries.map((entry) => entry.id)).toEqual([older]);
    await act(() => {
      menuAction?.("view.reopenClosed");
    });
    expect(state.openPreview).toHaveBeenCalledOnce();
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).activeSurfaceId,
    ).toBe("diff");
    expect(useClosedViewStore.getState().entries).toEqual([]);
  });

  it.each(["files", "file", "browser"] as const)(
    "keeps a failed %s restore retryable without blocking older history",
    async (kind) => {
      const store = useClosedViewStore.getState();
      const older = store.remember({
        kind: "panel-tab",
        threadRef: ref,
        surface: { kind: "diff", id: "diff" },
      });
      const failed = store.remember(
        kind === "browser"
          ? { kind: "browser", threadRef: ref, snapshot }
          : {
              kind: "panel-tab",
              threadRef: ref,
              surface:
                kind === "files"
                  ? { kind: "files", id: "files" }
                  : {
                      kind: "file",
                      id: "file:src/app.ts",
                      relativePath: "src/app.ts",
                      revealLine: null,
                      revealRequestId: 0,
                    },
            },
      );
      // A cached shell cannot tell a removed project from one not loaded yet.
      state.workspaceAvailable = false;
      state.shellStatus = "cached";
      state.openPreview.mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("offline"))));
      await render();
      await act(() => {
        press();
      });
      expect(useClosedViewStore.getState().entries.map((entry) => entry.id)).toEqual([
        older,
        failed,
      ]);
      expect(state.navigate).not.toHaveBeenCalled();
      await act(() => {
        menuAction?.("view.reopenClosed");
      });
      expect(
        selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).activeSurfaceId,
      ).toBe("diff");
      expect(useClosedViewStore.getState().entries.map((entry) => entry.id)).toEqual([failed]);
      state.workspaceAvailable = true;
      state.openPreview.mockResolvedValue(AsyncResult.success({ ...snapshot, tabId: "new-tab" }));
      await act(() => {
        press();
      });
      expect(
        selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).activeSurfaceId,
      ).toBe(
        kind === "browser" ? "browser:new-tab" : kind === "file" ? "file:src/app.ts" : "files",
      );
      expect(useClosedViewStore.getState().entries).toEqual([]);
    },
  );

  it("drops a files tab whose project a live shell no longer has", async () => {
    const store = useClosedViewStore.getState();
    const older = store.remember({
      kind: "panel-tab",
      threadRef: ref,
      surface: { kind: "diff", id: "diff" },
    });
    store.remember({ kind: "panel-tab", threadRef: ref, surface: { kind: "files", id: "files" } });
    state.workspaceAvailable = false;
    await render();
    await act(() => {
      press();
    });
    expect(useClosedViewStore.getState().entries.map((entry) => entry.id)).toEqual([older]);
    expect(state.toast).toHaveBeenCalledWith({
      type: "info",
      title: "That tab's project was removed",
    });
  });

  it("says why a press restored nothing", async () => {
    await render();
    useClosedViewStore.getState().remember({
      kind: "panel-tab",
      threadRef: { ...ref, environmentId: "gone" as ScopedThreadRef["environmentId"] },
      surface: { kind: "diff", id: "diff" },
    });
    await act(() => {
      press();
    });
    expect(useClosedViewStore.getState().entries).toEqual([]);
    expect(state.toast).toHaveBeenCalledWith({ type: "info", title: "No closed tabs to reopen" });
  });
  it("forwards the chord to a focused desktop browser only while history exists", async () => {
    useClosedViewStore
      .getState()
      .remember({ kind: "panel-tab", threadRef: ref, surface: { kind: "diff", id: "diff" } });
    await render();
    const forwardedCommands = () =>
      ((state.setShortcuts.mock.calls.at(-1) as unknown[] | undefined)?.[0] as
        | ReadonlyArray<{ command: string }>
        | undefined)!.map(({ command }) => command);
    expect(forwardedCommands()).toContain("view.reopenClosed");
    await act(() => {
      menuAction?.("view.reopenClosed");
    });
    expect(useClosedViewStore.getState().entries).toEqual([]);
    expect(forwardedCommands()).not.toContain("view.reopenClosed");
    // F6 still leaves a focused desktop browser.
    expect(forwardedCommands()).toContain("workspace.focusNext");
  });
});
