import type { ThreadPendingRequestSummary } from "@e6tools/contracts";
import type { ClientSettings } from "@e6tools/contracts/settings";
import * as Option from "effect/Option";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

type Settings = Pick<
  ClientSettings,
  | "attentionNotifications"
  | "notifyWatchedThreads"
  | "holdFinishedUntilBreakpoint"
  | "attentionSoundEnabled"
>;

const state = vi.hoisted(() => ({
  settings: {
    attentionNotifications: "blocked",
    notifyWatchedThreads: true,
    holdFinishedUntilBreakpoint: true,
    attentionSoundEnabled: false,
  } as Settings,
  active: { environmentId: "one", threadId: "elsewhere" } as Record<string, string>,
  focused: true,
  /** Another window of the app has focus (shared over the window-focus channel). */
  anotherWindowFocused: false,
  secureContext: true,
  /** Keys the sidebar still counts as blocked on you. */
  blockedKeys: [] as string[],
  shells: new Map<string, unknown>(),
  environmentIds: ["one"],
  blockedCount: 0,
  add: vi.fn(
    (_toast: {
      title: string;
      description?: string;
      actionProps?: unknown;
      data?: { activate?: { onActivate: () => void } };
    }) => "toast",
  ),
  close: vi.fn(),
  navigate: vi.fn(),
  sound: vi.fn(),
  dock: vi.fn(),
}));

vi.mock("@effect/atom-react", () => ({ useAtomValue: (id: string) => state.shells.get(id) }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => state.navigate,
  useParams: () => state.active,
}));
vi.mock("../hooks/useSettings", () => ({
  useClientSettings: (select: (settings: Settings) => unknown) => select(state.settings),
  getClientSettings: () => state.settings,
}));
vi.mock("../hooks/useThreadAttention", () => ({
  useBlockedThreadCount: () => state.blockedCount,
  getThreadAttention: () => ({
    blocked: state.blockedKeys.map((key) => ({ key })),
    earlier: [],
  }),
}));
vi.mock("../windowFocusChannel", () => ({
  shareWindowFocus: () => () => undefined,
  isAnotherWindowFocused: () => state.anotherWindowFocused,
}));
vi.mock("../state/environments", () => ({
  useEnvironments: () => ({
    environments: state.environmentIds.map((environmentId) => ({ environmentId })),
  }),
}));
vi.mock("../state/shell", () => ({ environmentShell: { stateValueAtom: (id: string) => id } }));
vi.mock("../threadNotifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../threadNotifications")>()),
  playNotificationSound: state.sound,
  unlockNotificationAudio: vi.fn(),
  setDockBadge: state.dock,
}));
vi.mock("./ui/toast", () => ({ toastManager: { add: state.add, close: state.close } }));

import { useThreadWatchStore } from "../threadWatchStore";
import { ThreadNotificationCoordinator } from "./ThreadNotificationCoordinator";

class TestNotification extends EventTarget {
  /** A fresh profile has not been asked yet. */
  static permission: NotificationPermission = "default";
  static sent: TestNotification[] = [];
  close = vi.fn();
  get tag() {
    return this.options.tag ?? "";
  }
  constructor(
    readonly title: string,
    readonly options: NotificationOptions,
  ) {
    super();
    TestNotification.sent.push(this);
  }
}

const baseThread = {
  title: "Fix the login form",
  archivedAt: null as string | null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  pendingRequestSummary: undefined as ThreadPendingRequestSummary | undefined,
  session: null as { status: string; providerName: string; lastError: string | null } | null,
  latestTurn: {
    turnId: "turn",
    state: "running",
    startedAt: "2026-09-13T08:00:00Z",
    completedAt: null as string | null,
  },
};

function setThreads(
  environmentId: string,
  threads: ReadonlyArray<Partial<typeof baseThread> & { id: string }>,
) {
  state.shells.set(environmentId, {
    status: "live",
    snapshot: Option.some({ threads: threads.map((thread) => ({ ...baseThread, ...thread })) }),
  });
}

function finished(id: string, completedAt = "2026-09-13T08:03:40Z") {
  return { id, latestTurn: { ...baseThread.latestTurn, state: "completed", completedAt } };
}

let renderer: ReactTestRenderer | undefined;
async function render() {
  await act(async () => {
    if (renderer) renderer.update(<ThreadNotificationCoordinator />);
    else renderer = create(<ThreadNotificationCoordinator />);
  });
}

const titles = () => state.add.mock.calls.map(([toast]) => toast.title);

/** The user allowed system notifications. */
function grantNotifications() {
  TestNotification.permission = "granted";
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-09-13T09:00:00Z"));
  state.settings = {
    attentionNotifications: "blocked",
    notifyWatchedThreads: true,
    holdFinishedUntilBreakpoint: true,
    attentionSoundEnabled: false,
  };
  state.active = { environmentId: "one", threadId: "elsewhere" };
  state.focused = true;
  state.anotherWindowFocused = false;
  state.secureContext = true;
  state.blockedKeys = [];
  state.environmentIds = ["one"];
  state.blockedCount = 0;
  state.shells.clear();
  setThreads("one", [{ id: "a" }, { id: "b" }]);
  TestNotification.permission = "default";
  TestNotification.sent = [];
  useThreadWatchStore.setState({ watched: {}, sendSequence: 0 });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Notification", TestNotification);
  vi.stubGlobal(
    "window",
    Object.defineProperty(
      Object.assign(new EventTarget(), { focus: vi.fn(), setTimeout, clearTimeout }),
      "isSecureContext",
      { get: () => state.secureContext },
    ),
  );
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), {
      hasFocus: () => state.focused,
      visibilityState: "visible",
    }),
  );
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("blocked agents", () => {
  it("toast at once while you work in another thread, and open the thread", async () => {
    await render();
    setThreads("one", [{ id: "a", hasPendingApprovals: true }, { id: "b" }]);
    await render();
    expect(titles()).toEqual(["Approval needed"]);
    expect(state.add.mock.calls[0]?.[0].description).toBe(
      "Fix the login form · The agent is waiting for your approval",
    );
    // The toast carries no button; activating the toast itself opens the thread.
    expect(state.add.mock.calls[0]?.[0].actionProps).toBeUndefined();
    state.add.mock.calls[0]![0].data!.activate!.onActivate();
    expect(state.navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: "one", threadId: "a" },
    });
  });

  it("send a system notification while the window is away, without the question", async () => {
    grantNotifications();
    state.focused = false;
    await render();
    setThreads("one", [
      {
        id: "a",
        hasPendingUserInput: true,
        pendingRequestSummary: {
          approvalCount: 0,
          userInputCount: 1,
          questionCount: 1,
          question: "Which database password should I use?",
        },
      },
      { id: "b" },
    ]);
    await render();
    expect(TestNotification.sent.map((n) => [n.title, n.options.body])).toEqual([
      ["Input needed", "Fix the login form · The agent asks 1 question"],
    ]);
    expect(state.add).not.toHaveBeenCalled();
  });

  it.each([
    ["on a fresh profile", () => undefined],
    [
      "outside a secure context",
      () => {
        grantNotifications();
        state.secureContext = false;
      },
    ],
  ])("hold a blocked agent %s, then toast it when you return", async (_, setup) => {
    setup();
    state.focused = false;
    await render();
    setThreads("one", [{ id: "a", hasPendingApprovals: true }, { id: "b" }]);
    state.blockedKeys = ["one:a"];
    await render();
    expect(TestNotification.sent).toHaveLength(0);
    expect(state.add).not.toHaveBeenCalled();
    state.focused = true;
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(titles()).toEqual(["Approval needed"]);
  });

  it("drop a held blocked agent that was answered before you returned", async () => {
    state.focused = false;
    await render();
    setThreads("one", [{ id: "a", hasPendingApprovals: true }, { id: "b" }]);
    await render();
    // Answered in another window: no longer blocked.
    state.focused = true;
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(state.add).not.toHaveBeenCalled();
  });

  it("leave a blocked agent to the window you are working in", async () => {
    grantNotifications();
    state.focused = false;
    state.anotherWindowFocused = true;
    await render();
    setThreads("one", [{ id: "a", hasPendingApprovals: true }, { id: "b" }]);
    await render();
    expect(TestNotification.sent).toHaveLength(0);
    expect(state.add).not.toHaveBeenCalled();
  });

  it("add nothing in the thread you are looking at", async () => {
    state.active = { environmentId: "one", threadId: "a" };
    await render();
    setThreads("one", [{ id: "a", hasPendingApprovals: true }, { id: "b" }]);
    await render();
    expect(state.add).not.toHaveBeenCalled();
    expect(TestNotification.sent).toHaveLength(0);
  });

  it("play one sound only when sound is on", async () => {
    state.settings = { ...state.settings, attentionSoundEnabled: true };
    await render();
    setThreads("one", [{ id: "a", hasPendingApprovals: true }, finished("b")]);
    await render();
    expect(state.sound).toHaveBeenCalledTimes(1);
    expect(state.sound).toHaveBeenCalledWith("input", expect.any(Function));
  });

  it("notify nothing when notifications are off", async () => {
    state.settings = { ...state.settings, attentionNotifications: "off" };
    state.focused = false;
    await render();
    setThreads("one", [{ id: "a", hasPendingApprovals: true }, finished("b")]);
    await render();
    expect(state.add).not.toHaveBeenCalled();
    expect(TestNotification.sent).toHaveLength(0);
  });
});

describe("finished threads", () => {
  it("wait for a pause and arrive as one digest", async () => {
    await render();
    setThreads("one", [finished("a"), finished("b")]);
    await render();
    expect(state.add).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(20_000));
    expect(titles()).toEqual(["2 threads finished"]);
    (state.add.mock.calls[0]![0].actionProps as { onClick: () => void }).onClick();
    expect(titles()).toEqual(["2 threads finished", "Thread completed", "Thread completed"]);
  });

  it("are held while you keep typing, but never past 5 minutes", async () => {
    await render();
    setThreads("one", [finished("a"), { id: "b" }]);
    await render();
    for (let second = 0; second < 300; second += 10) {
      await act(async () => {
        document.dispatchEvent(new Event("keydown"));
        vi.advanceTimersByTime(10_000);
      });
      if (second < 290) expect(state.add).not.toHaveBeenCalled();
    }
    expect(titles()).toEqual(["Thread completed"]);
  });

  it("come through when you switch thread", async () => {
    await render();
    setThreads("one", [finished("a"), { id: "b" }]);
    await render();
    state.active = { environmentId: "one", threadId: "b" };
    await render();
    expect(titles()).toEqual(["Thread completed"]);
  });

  it("wait for you to return to the window, without a system notification", async () => {
    state.focused = false;
    await render();
    setThreads("one", [finished("a"), { id: "b" }]);
    await render();
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(TestNotification.sent).toHaveLength(0);
    expect(state.add).not.toHaveBeenCalled();
    state.focused = true;
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(titles()).toEqual(["Thread completed"]);
  });

  it("call you back for the thread you sent a message to, then stop watching it", async () => {
    grantNotifications();
    state.focused = false;
    await render();
    useThreadWatchStore.getState().noteSent("one:a");
    setThreads("one", [finished("a"), { id: "b" }]);
    await render();
    expect(TestNotification.sent.map((n) => n.options.body)).toEqual([
      "Fix the login form · worked 3m 40s",
    ]);
    expect(useThreadWatchStore.getState().watched).toEqual({});
  });

  it("call you back under Quiet when you asked from the now bar", async () => {
    grantNotifications();
    state.settings = { ...state.settings, notifyWatchedThreads: false };
    state.focused = false;
    await render();
    useThreadWatchStore.getState().noteSent("one:a");
    useThreadWatchStore.getState().choose("one:a", true);
    setThreads("one", [finished("a"), { id: "b" }]);
    await render();
    expect(TestNotification.sent.map((n) => n.title)).toEqual(["Thread completed"]);
  });

  it("show the watched thread on its own when you send your next message", async () => {
    await render();
    await act(async () => useThreadWatchStore.getState().noteSent("one:a"));
    setThreads("one", [finished("a"), finished("b")]);
    await render();
    expect(state.add).not.toHaveBeenCalled();
    await act(async () => useThreadWatchStore.getState().noteSent("one:b"));
    expect(titles()).toEqual(["Thread completed", "Thread completed"]);
  });

  it("notify at once with every update", async () => {
    grantNotifications();
    state.settings = { ...state.settings, attentionNotifications: "all" };
    state.focused = false;
    await render();
    setThreads("one", [finished("a"), { id: "b" }]);
    await render();
    expect(TestNotification.sent.map((n) => n.title)).toEqual(["Thread completed"]);
  });

  it("are not replayed on first load or reconnect", async () => {
    setThreads("one", [finished("a"), { id: "b" }]);
    await render();
    state.shells.set("one", { status: "connecting", snapshot: Option.none() });
    await render();
    setThreads("one", [finished("a"), { id: "b" }]);
    await render();
    await act(async () => vi.advanceTimersByTime(300_000));
    expect(state.add).not.toHaveBeenCalled();
  });
});

describe("environments and the dock", () => {
  it("closes system notifications from an environment that leaves", async () => {
    grantNotifications();
    state.focused = false;
    state.environmentIds = ["one", "two"];
    setThreads("two", [{ id: "a" }]);
    await render();
    setThreads("one", [{ id: "a", hasPendingApprovals: true }]);
    setThreads("two", [{ id: "a", hasPendingApprovals: true }]);
    await render();
    expect(TestNotification.sent).toHaveLength(2);
    const [removed, retained] = TestNotification.sent;
    expect(removed?.tag).not.toBe(retained?.tag);
    state.environmentIds = ["two"];
    await render();
    expect(removed?.close).toHaveBeenCalled();
    expect(retained?.close).not.toHaveBeenCalled();
  });

  it("keeps the dock badge at the blocked count through focus and unmount", async () => {
    state.blockedCount = 2;
    await render();
    expect(state.dock).toHaveBeenLastCalledWith(2);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(state.dock).toHaveBeenLastCalledWith(2);
    state.blockedCount = 1;
    await render();
    await act(async () => renderer!.unmount());
    renderer = undefined;
    // Other windows may still be blocked; the main process clears it on quit.
    expect(state.dock).toHaveBeenLastCalledWith(1);
  });
});
