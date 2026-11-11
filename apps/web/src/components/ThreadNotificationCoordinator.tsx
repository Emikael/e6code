import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { scopedThreadKey, scopeThreadRef } from "@e6tools/client-runtime/environment";
import { PROVIDER_DISPLAY_NAMES, type EnvironmentId, type ThreadId } from "@e6tools/contracts";
import * as Option from "effect/Option";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { getClientSettings, useClientSettings } from "../hooks/useSettings";
import { useBlockedThreadCount } from "../hooks/useThreadAttention";
import { useEnvironments } from "../state/environments";
import { environmentShell } from "../state/shell";
import {
  nextDigestFlushAtMs,
  resolveThreadNotificationDelivery,
  THREAD_NOTIFICATION_TITLES,
  threadNotificationBody,
  type ThreadNotificationKind,
} from "../threadNotificationPolicy";
import {
  playNotificationSound,
  setDockBadge,
  unlockNotificationAudio,
} from "../threadNotifications";
import { useThreadWatchStore } from "../threadWatchStore";
import { resolveSidebarThreadStatus } from "./Sidebar.logic";
import { toastManager } from "./ui/toast";

/** One thread event the coordinator should deliver now or hold for a pause. */
interface ThreadNotice {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly kind: ThreadNotificationKind;
  readonly title: string;
  readonly body: string;
}

interface HeldNotice extends ThreadNotice {
  readonly watched: boolean;
  readonly heldAtMs: number;
}

// Focus mode (phase 11) holds the digest until exit; until it exists nothing holds.
const FOCUS_HOLD = false;

const providerLabel = (name: string) =>
  (PROVIDER_DISPLAY_NAMES as Record<string, string | undefined>)[name];

function isWindowFocused() {
  return document.visibilityState === "visible" && document.hasFocus();
}

function noticeIcon(kind: ThreadNotificationKind) {
  switch (kind) {
    case "completion":
      return <CircleCheckIcon aria-hidden className="size-4 text-success-foreground" />;
    case "approval":
      return <ShieldQuestionIcon aria-hidden className="size-4 text-warning-foreground" />;
    case "failed":
      return <CircleAlertIcon aria-hidden className="size-4 text-destructive-foreground" />;
    case "input":
      return <MessageCircleQuestionIcon aria-hidden className="size-4 text-warning-foreground" />;
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
    new Map<string, { environmentId: EnvironmentId; notification: Notification }>(),
  );
  const held = useRef(new Map<string, HeldNotice>());
  const lastInputAtMs = useRef(0);
  const flushTimer = useRef<number | undefined>(undefined);

  const openThread = useCallback(
    (environmentId: EnvironmentId, threadId: ThreadId) =>
      void navigate({ to: "/$environmentId/$threadId", params: { environmentId, threadId } }),
    [navigate],
  );

  const showToast = useCallback(
    (notice: ThreadNotice) => {
      const toastId = toastManager.add({
        type:
          notice.kind === "completion" ? "success" : notice.kind === "failed" ? "error" : "warning",
        title: notice.title,
        description: notice.body,
        data: { hideCopyButton: true, leadingIcon: noticeIcon(notice.kind) },
        actionProps: {
          children: "Open thread",
          onClick: () => {
            toastManager.close(toastId);
            openThread(notice.environmentId, notice.threadId);
          },
        },
      });
    },
    [openThread],
  );

  const showSystemNotification = useCallback(
    (notice: ThreadNotice) => {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      try {
        const notification = new Notification(notice.title, {
          body: notice.body,
          tag: notice.key,
          silent: true,
        });
        pending.current.get(notification.tag)?.notification.close();
        pending.current.set(notification.tag, {
          environmentId: notice.environmentId,
          notification,
        });
        notification.addEventListener("click", () => {
          notification.close();
          window.focus();
          openThread(notice.environmentId, notice.threadId);
        });
      } catch {
        // Some browsers expose Notification but reject desktop presentation.
      }
    },
    [openThread],
  );

  const flushDigest = useCallback(() => {
    window.clearTimeout(flushTimer.current);
    flushTimer.current = undefined;
    if (held.current.size === 0 || FOCUS_HOLD || !isWindowFocused()) return;
    const notices = [...held.current.values()].sort((a, b) => a.heldAtMs - b.heldAtMs);
    held.current.clear();
    // The thread you were waiting on gets its own toast; the rest share one.
    const others = notices.filter((notice) => !notice.watched);
    for (const notice of notices) if (notice.watched) showToast(notice);
    const [only] = others;
    if (others.length === 1 && only) {
      showToast(only);
    } else if (others.length > 1) {
      const toastId = toastManager.add({
        type: "success",
        title: `${others.length} threads finished`,
        data: { hideCopyButton: true, leadingIcon: noticeIcon("completion") },
        actionProps: {
          children: "Show",
          onClick: () => {
            toastManager.close(toastId);
            for (const notice of others) showToast(notice);
          },
        },
      });
    }
  }, [showToast]);

  const scheduleFlush = useCallback(() => {
    window.clearTimeout(flushTimer.current);
    let oldest: number | null = null;
    for (const notice of held.current.values()) {
      oldest = oldest === null ? notice.heldAtMs : Math.min(oldest, notice.heldAtMs);
    }
    const flushAt = nextDigestFlushAtMs({
      oldestHeldAtMs: oldest,
      lastInputAtMs: lastInputAtMs.current,
      focusHold: FOCUS_HOLD,
    });
    if (flushAt === null) return;
    flushTimer.current = window.setTimeout(
      () => {
        // Input since scheduling moves the pause later; check again then.
        const due = nextDigestFlushAtMs({
          oldestHeldAtMs: oldest,
          lastInputAtMs: lastInputAtMs.current,
          focusHold: FOCUS_HOLD,
        });
        if (due !== null && due > Date.now()) scheduleFlush();
        else flushDigest();
      },
      Math.max(0, flushAt - Date.now()),
    );
  }, [flushDigest]);

  const deliver = useCallback(
    (notice: ThreadNotice, options: { readonly isOpenThread: boolean }) => {
      const settings = getClientSettings();
      const blocked = notice.kind !== "completion";
      const { watched } = useThreadWatchStore.getState();
      const isWatched = Boolean(watched[notice.key]);
      // A turn that ended, either way, ends the watch.
      if (notice.kind === "completion" || notice.kind === "failed") {
        useThreadWatchStore.getState().setWatched(notice.key, false);
      }
      const windowFocused = isWindowFocused();
      const delivery = resolveThreadNotificationDelivery({
        event: blocked ? "blocked" : "finished",
        windowFocused,
        isOpenThread: options.isOpenThread,
        watched: isWatched,
        focusHold: FOCUS_HOLD,
        settings,
      });
      if (delivery === "none") return;
      if (blocked && settings.attentionSoundEnabled) {
        void playNotificationSound("input", () => getClientSettings().attentionSoundEnabled);
      }
      if (delivery === "os") showSystemNotification(notice);
      else if (delivery === "toast") showToast(notice);
      else {
        held.current.set(notice.key, { ...notice, watched: isWatched, heldAtMs: Date.now() });
        scheduleFlush();
      }
    },
    [scheduleFlush, showSystemNotification, showToast],
  );

  // Close system notifications from environments that leave the client.
  useEffect(() => {
    const activeIds = new Set(environments.map(({ environmentId }) => environmentId));
    for (const [tag, { environmentId, notification }] of pending.current) {
      if (activeIds.has(environmentId)) continue;
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

  // Sending a message and switching thread are breakpoints.
  const switchKey = `${activeEnvironmentId ?? ""}:${activeThreadId ?? ""}`;
  useEffect(() => {
    flushDigest();
  }, [flushDigest, sendSequence, switchKey]);

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
          kind,
          title: THREAD_NOTIFICATION_TITLES[kind],
          body: threadNotificationBody(thread, kind, providerLabel),
        },
        { isOpenThread: activeEnvironmentId === environmentId && activeThreadId === thread.id },
      );
    }
    previous.current = next;
  }, [activeEnvironmentId, activeThreadId, deliver, environmentId, shell]);

  return null;
}
