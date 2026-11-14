import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { scopedThreadKey, scopeThreadRef } from "@e6tools/client-runtime/environment";
import { PROVIDER_DISPLAY_NAMES, type EnvironmentId, type ThreadId } from "@e6tools/contracts";
import * as Option from "effect/Option";
import { CheckIcon, CircleAlertIcon, MessageCircleQuestionIcon } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { getClientSettings, useClientSettings } from "../hooks/useSettings";
import { getThreadAttention, useBlockedThreadCount } from "../hooks/useThreadAttention";
import { useEnvironments } from "../state/environments";
import { environmentShell } from "../state/shell";
import {
  finishedDigestTitle,
  groupThreadDeliveries,
  isFocusHoldActive,
  isThreadWatched,
  nextDigestFlushAtMs,
  resolveThreadNotificationDelivery,
  selectHeldForFlush,
  THREAD_NOTIFICATION_TITLES,
  threadNotificationBody,
  type ThreadNotificationKind,
} from "../threadNotificationPolicy";
import {
  playNotificationSound,
  setDockBadge,
  systemNotificationsAvailable,
  unlockNotificationAudio,
} from "../threadNotifications";
import { useThreadWatchStore } from "../threadWatchStore";
import { useUiStateStore } from "../uiStateStore";
import { isAnotherWindowFocused, shareWindowFocus } from "../windowFocusChannel";
import { resolveSidebarThreadStatus } from "./Sidebar.logic";
import { BlockedDiamond } from "./SidebarNeedsYou";
import { toastManager } from "./ui/toast";

/** One thread event the coordinator should deliver now or hold for a pause. */
interface ThreadNotice {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly threadTitle: string;
  readonly kind: ThreadNotificationKind;
  readonly title: string;
  /** For the in-app toast: may quote the agent's question. */
  readonly body: string;
  /** For the system notification: never the question text, which a lock screen would show. */
  readonly systemBody: string;
}

interface HeldNotice extends ThreadNotice {
  readonly watched: boolean;
  readonly heldAtMs: number;
}

interface PassEntry {
  readonly notice: ThreadNotice;
  readonly isOpenThread: boolean;
}

const providerLabel = (name: string) =>
  (PROVIDER_DISPLAY_NAMES as Record<string, string | undefined>)[name];

function isWindowFocused() {
  return document.visibilityState === "visible" && document.hasFocus();
}

/** The marks board 7 draws: an 8px diamond for approval, 14px glyphs otherwise. */
function noticeIcon(kind: ThreadNotificationKind) {
  switch (kind) {
    case "completion":
      return <CheckIcon aria-hidden className="size-3.5 text-success-foreground" />;
    case "approval":
      return <BlockedDiamond />;
    case "failed":
      return <CircleAlertIcon aria-hidden className="size-3.5 text-destructive-foreground" />;
    case "input":
      return <MessageCircleQuestionIcon aria-hidden className="size-3.5 text-warning-foreground" />;
  }
}

/**
 * The return cue. Blocked agents and the thread you are waiting on reach you
 * now; other finished threads are held until a pause (you send, switch
 * thread, return to the window, or stop typing for 20 seconds) and arrive as
 * one digest. `threadNotificationPolicy.ts` decides; this applies it.
 */
export function ThreadNotificationCoordinator() {
  const { environments } = useEnvironments();
  const attentionNotifications = useClientSettings((settings) => settings.attentionNotifications);
  const soundEnabled = useClientSettings((settings) => settings.attentionSoundEnabled);
  const navigate = useNavigate();
  const { environmentId: activeEnvironmentId, threadId: activeThreadId } = useParams({
    strict: false,
  });
  const sendSequence = useThreadWatchStore((state) => state.sendSequence);

  const pending = useRef(
    new Map<string, { environmentId: EnvironmentId | null; notification: Notification }>(),
  );
  const held = useRef(new Map<string, HeldNotice>());
  const pass = useRef<PassEntry[]>([]);
  const lastInputAtMs = useRef(0);
  const flushTimer = useRef<number | undefined>(undefined);
  const openThreadKey = useRef<string | null>(null);
  /** When each thread was last opened in this window. */
  const visitedAtMs = useRef(new Map<string, number>());
  /** Focus mode holds other finished threads while it shows a thread, unless the setting is off. */
  const focusHoldActive = useCallback(
    () =>
      isFocusHoldActive({
        focusMode: useUiStateStore.getState().focusMode,
        focusHoldsFinished: getClientSettings().focusHoldsFinished,
        openThreadKey: openThreadKey.current,
      }),
    [],
  );

  const openThread = useCallback(
    (environmentId: EnvironmentId, threadId: ThreadId) =>
      void navigate({ to: "/$environmentId/$threadId", params: { environmentId, threadId } }),
    [navigate],
  );

  // Board 7: the mark, the headline and "now"; the toast itself opens the thread.
  const showToast = useCallback(
    (notice: ThreadNotice) => {
      toastManager.add({
        type:
          notice.kind === "completion" ? "success" : notice.kind === "failed" ? "error" : "warning",
        title: notice.title,
        description: notice.body,
        data: {
          hideCopyButton: true,
          leadingIcon: noticeIcon(notice.kind),
          trailingMeta: "now",
          activate: {
            label: `Open thread: ${notice.threadTitle}`,
            onActivate: () => openThread(notice.environmentId, notice.threadId),
          },
        },
      });
    },
    [openThread],
  );

  const showDigestToast = useCallback(
    (notices: ReadonlyArray<ThreadNotice>) => {
      const toastId = toastManager.add({
        type: "success",
        title: finishedDigestTitle(notices.length),
        data: {
          hideCopyButton: true,
          // Board 7 draws the digest's tick at 16px; single notices use 14px.
          leadingIcon: <CheckIcon aria-hidden className="size-4 text-success-foreground" />,
          actionVariant: "ghost",
          actionSize: "sm",
        },
        actionProps: {
          children: "Show",
          onClick: () => {
            toastManager.close(toastId);
            for (const notice of notices) showToast(notice);
          },
        },
      });
    },
    [showToast],
  );

  const raiseSystemNotification = useCallback(
    (
      tag: string,
      title: string,
      body: string,
      environmentId: EnvironmentId | null,
      onClick: () => void,
    ) => {
      if (!systemNotificationsAvailable()) return;
      try {
        const notification = new Notification(title, { body, tag, silent: true });
        pending.current.get(tag)?.notification.close();
        pending.current.set(tag, { environmentId, notification });
        notification.addEventListener("click", () => {
          notification.close();
          window.focus();
          onClick();
        });
      } catch {
        // Some browsers expose Notification but reject desktop presentation.
      }
    },
    [],
  );

  const showSystemNotification = useCallback(
    (notice: ThreadNotice) =>
      raiseSystemNotification(
        notice.key,
        notice.title,
        notice.systemBody,
        notice.environmentId,
        () => openThread(notice.environmentId, notice.threadId),
      ),
    [openThread, raiseSystemNotification],
  );

  const flushDigest = useCallback(() => {
    window.clearTimeout(flushTimer.current);
    flushTimer.current = undefined;
    if (held.current.size === 0 || !isWindowFocused()) return;
    const { own, digest, keep } = selectHeldForFlush([...held.current.values()], {
      openThreadKey: openThreadKey.current,
      visitedAtMsByKey: visitedAtMs.current,
      focusHold: focusHoldActive(),
      isStillBlocked: (key) => {
        const { blocked, earlier } = getThreadAttention();
        return blocked.some((item) => item.key === key) || earlier.some((item) => item.key === key);
      },
    });
    held.current = new Map(keep.map((notice) => [notice.key, notice]));
    // Blocked items and the thread you were waiting on get their own toast; the rest share one.
    for (const notice of own) showToast(notice);
    const [only] = digest;
    if (digest.length === 1 && only) showToast(only);
    else if (digest.length > 1) showDigestToast(digest);
  }, [focusHoldActive, showDigestToast, showToast]);

  const scheduleFlush = useCallback(() => {
    window.clearTimeout(flushTimer.current);
    let oldest: number | null = null;
    for (const notice of held.current.values()) {
      oldest = oldest === null ? notice.heldAtMs : Math.min(oldest, notice.heldAtMs);
    }
    const flushAt = nextDigestFlushAtMs({
      oldestHeldAtMs: oldest,
      lastInputAtMs: lastInputAtMs.current,
      focusHold: focusHoldActive(),
    });
    if (flushAt === null) return;
    flushTimer.current = window.setTimeout(
      () => {
        // Input since scheduling moves the pause later; check again then.
        const due = nextDigestFlushAtMs({
          oldestHeldAtMs: oldest,
          lastInputAtMs: lastInputAtMs.current,
          focusHold: focusHoldActive(),
        });
        if (due !== null && due > Date.now()) scheduleFlush();
        else flushDigest();
      },
      Math.max(0, flushAt - Date.now()),
    );
  }, [flushDigest, focusHoldActive]);

  /** Applies the policy to every event of one snapshot pass, then delivers them together. */
  const deliverPass = useCallback(() => {
    const entries = pass.current;
    pass.current = [];
    const settings = getClientSettings();
    const windowFocused = isWindowFocused();
    const anotherWindowFocused = isAnotherWindowFocused();
    const osAvailable = systemNotificationsAvailable();
    const focusHold = focusHoldActive();
    const now: Array<{ notice: ThreadNotice; delivery: "os" | "toast" }> = [];
    let heldAny = false;
    let blockedDelivered = false;
    for (const { notice, isOpenThread } of entries) {
      const blocked = notice.kind !== "completion";
      const isWatched = isThreadWatched(
        useThreadWatchStore.getState().watched[notice.key],
        settings,
      );
      // A turn that ended, either way, ends the watch.
      if (notice.kind === "completion" || notice.kind === "failed") {
        useThreadWatchStore.getState().endWatch(notice.key);
      }
      const delivery = resolveThreadNotificationDelivery({
        event: blocked ? "blocked" : "finished",
        windowFocused,
        anotherWindowFocused,
        systemNotificationsAvailable: osAvailable,
        isOpenThread,
        watched: isWatched,
        focusHold,
        settings,
      });
      if (delivery === "none") continue;
      if (blocked) blockedDelivered = true;
      if (delivery === "os" || delivery === "toast") {
        now.push({ notice, delivery });
      } else {
        held.current.set(notice.key, { ...notice, watched: isWatched, heldAtMs: Date.now() });
        heldAny = true;
      }
    }
    if (blockedDelivered && settings.attentionSoundEnabled) {
      void playNotificationSound("input", () => getClientSettings().attentionSoundEnabled);
    }
    for (const { delivery, notices } of groupThreadDeliveries(now)) {
      const [only] = notices;
      if (notices.length === 1 && only) {
        if (delivery === "os") showSystemNotification(only);
        else showToast(only);
      } else if (delivery === "toast") {
        showDigestToast(notices);
      } else {
        raiseSystemNotification(
          "e6:threads-finished",
          finishedDigestTitle(notices.length),
          notices.map((notice) => notice.threadTitle).join(", "),
          null,
          () => undefined,
        );
      }
    }
    if (heldAny) scheduleFlush();
  }, [
    focusHoldActive,
    raiseSystemNotification,
    scheduleFlush,
    showDigestToast,
    showSystemNotification,
    showToast,
  ]);

  const deliver = useCallback(
    (notice: ThreadNotice, options: { readonly isOpenThread: boolean }) => {
      // Every environment reports its snapshot in the same commit; deliver them as one pass.
      if (pass.current.length === 0) queueMicrotask(deliverPass);
      pass.current.push({ notice, isOpenThread: options.isOpenThread });
    },
    [deliverPass],
  );

  useEffect(() => shareWindowFocus(), []);

  // Close system notifications from environments that leave the client.
  useEffect(() => {
    const activeIds = new Set(environments.map(({ environmentId }) => environmentId));
    for (const [tag, { environmentId, notification }] of pending.current) {
      if (environmentId === null || activeIds.has(environmentId)) continue;
      notification.close();
      pending.current.delete(tag);
    }
    for (const [key, notice] of held.current) {
      if (!activeIds.has(notice.environmentId)) held.current.delete(key);
    }
  }, [environments]);

  // Returning to the window closes its system notifications and is a
  // breakpoint. The blocked count lives in the sidebar, the tab title and the
  // dock badge only; the favicon carries no count.
  useEffect(() => {
    const closeAll = () => {
      for (const { notification } of pending.current.values()) notification.close();
      pending.current.clear();
    };
    const onFocus = () => {
      closeAll();
      flushDigest();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      closeAll();
    };
  }, [flushDigest]);

  // Key and pointer input push the idle breakpoint back.
  useEffect(() => {
    const onInput = () => {
      lastInputAtMs.current = Date.now();
    };
    document.addEventListener("pointerdown", onInput, { capture: true, passive: true });
    document.addEventListener("keydown", onInput, { capture: true, passive: true });
    return () => {
      document.removeEventListener("pointerdown", onInput, { capture: true });
      document.removeEventListener("keydown", onInput, { capture: true });
    };
  }, []);

  // Leaving focus mode is a breakpoint: what it held arrives now.
  const focusMode = useUiStateStore((state) => state.focusMode);
  useEffect(() => {
    if (!focusMode) flushDigest();
  }, [flushDigest, focusMode]);

  // Opening a thread counts as seeing what was held for it.
  const activeKey =
    activeEnvironmentId && activeThreadId
      ? scopedThreadKey(
          scopeThreadRef(activeEnvironmentId as EnvironmentId, activeThreadId as ThreadId),
        )
      : null;
  useEffect(() => {
    openThreadKey.current = activeKey;
    if (activeKey) visitedAtMs.current.set(activeKey, Date.now());
  }, [activeKey]);

  // Sending a message and switching thread are breakpoints.
  useEffect(() => {
    flushDigest();
  }, [flushDigest, sendSequence, activeKey]);

  useEffect(() => {
    if (attentionNotifications !== "off") return;
    held.current.clear();
    window.clearTimeout(flushTimer.current);
  }, [attentionNotifications]);
  useEffect(() => () => window.clearTimeout(flushTimer.current), []);

  // The dock badge is a standing count of blocked threads, independent of
  // notification settings and window focus. It is not reset on unmount: other
  // windows may still have blocked threads, and the main process clears it
  // on quit.
  const blockedCount = useBlockedThreadCount();
  useEffect(() => {
    setDockBadge(blockedCount);
  }, [blockedCount]);

  useEffect(() => {
    if (!soundEnabled) return;
    document.addEventListener("pointerdown", unlockNotificationAudio);
    document.addEventListener("keydown", unlockNotificationAudio);
    return () => {
      document.removeEventListener("pointerdown", unlockNotificationAudio);
      document.removeEventListener("keydown", unlockNotificationAudio);
    };
  }, [soundEnabled]);

  if (attentionNotifications === "off") return null;

  return environments.map((environment) => (
    <EnvironmentNotifications
      key={environment.environmentId}
      environmentId={environment.environmentId}
      activeEnvironmentId={activeEnvironmentId}
      activeThreadId={activeThreadId}
      deliver={deliver}
    />
  ));
}

/** Watches one environment's threads and reports each new attention event once. */
function EnvironmentNotifications({
  environmentId,
  activeEnvironmentId,
  activeThreadId,
  deliver,
}: {
  environmentId: EnvironmentId;
  activeEnvironmentId: string | undefined;
  activeThreadId: string | undefined;
  deliver: (notice: ThreadNotice, options: { readonly isOpenThread: boolean }) => void;
}) {
  const shell = useAtomValue(environmentShell.stateValueAtom(environmentId));
  const previous = useRef(
    new Map<ThreadId, { attention: string | null; completion: number | null }>(),
  );

  useEffect(() => {
    if (shell.status !== "live" || Option.isNone(shell.snapshot)) {
      previous.current.clear();
      return;
    }
    const next = new Map<ThreadId, { attention: string | null; completion: number | null }>();
    for (const thread of shell.snapshot.value.threads) {
      const status = resolveSidebarThreadStatus(thread);
      const prior = previous.current.get(thread.id);
      const attention =
        status === "input" || status === "approval" || status === "failed"
          ? `${thread.latestTurn?.turnId ?? ""}:${status}`
          : null;
      const completedAt = Date.parse(thread.latestTurn?.completedAt ?? "");
      const completion =
        status === "ready" &&
        thread.latestTurn?.state === "completed" &&
        Number.isFinite(completedAt)
          ? completedAt
          : (prior?.completion ?? null);
      next.set(thread.id, { attention, completion });
      if (!prior || thread.archivedAt !== null) continue;
      const kind: ThreadNotificationKind | null =
        attention && attention !== prior.attention
          ? status === "approval"
            ? "approval"
            : status === "failed"
              ? "failed"
              : "input"
          : completion !== null && (prior.completion === null || completion > prior.completion)
            ? "completion"
            : null;
      if (!kind) continue;
      deliver(
        {
          key: scopedThreadKey(scopeThreadRef(environmentId, thread.id)),
          environmentId,
          threadId: thread.id,
          threadTitle: thread.title,
          kind,
          title: THREAD_NOTIFICATION_TITLES[kind],
          body: threadNotificationBody(thread, kind, providerLabel),
          systemBody: threadNotificationBody(thread, kind, providerLabel, {
            withQuestion: false,
          }),
        },
        { isOpenThread: activeEnvironmentId === environmentId && activeThreadId === thread.id },
      );
    }
    previous.current = next;
  }, [activeEnvironmentId, activeThreadId, deliver, environmentId, shell]);

  return null;
}
