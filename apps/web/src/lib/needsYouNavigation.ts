import { scopeThreadRef } from "@e6tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@e6tools/client-runtime/state/models";
import {
  nextNeedsYouTarget,
  type ThreadAttention,
} from "@e6tools/client-runtime/state/thread-attention";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { buildThreadRouteParams } from "~/threadRoutes";

/**
 * "Go to next thread that needs you", shared by the Mod+Alt+N shortcut and
 * the command palette: opens the next Blocked, then To review, thread after
 * the open one, or says "Nothing needs you" ("Nothing else needs you" when
 * only the open thread is waiting).
 */
export function goToNextThreadThatNeedsYou(input: {
  readonly attention: ThreadAttention<EnvironmentThreadShell>;
  readonly currentThreadKey: string | null;
  /** "blocked" walks only threads blocked on you, for a control that counts only those. */
  readonly scope?: "blocked" | "all";
  readonly navigate: (options: {
    to: "/$environmentId/$threadId";
    params: ReturnType<typeof buildThreadRouteParams>;
  }) => unknown;
}): void {
  const target = nextNeedsYouTarget(input.attention, input.currentThreadKey, {
    scope: input.scope ?? "all",
  });
  if (target === null) {
    toastManager.add(
      stackedThreadToast({
        type: "info",
        title: nothingNeedsYouMessage(input.attention, input.currentThreadKey),
      }),
    );
    return;
  }
  void input.navigate({
    to: "/$environmentId/$threadId",
    params: buildThreadRouteParams(scopeThreadRef(target.thread.environmentId, target.thread.id)),
  });
}

/** The toast when there is nowhere to go: the open thread may be the only one waiting. */
export function nothingNeedsYouMessage(
  attention: Pick<ThreadAttention<EnvironmentThreadShell>, "blocked" | "earlier" | "review">,
  currentThreadKey: string | null,
): "Nothing needs you" | "Nothing else needs you" {
  const openIsWaiting =
    currentThreadKey !== null &&
    [...attention.blocked, ...attention.earlier, ...attention.review].some(
      (item) => item.key === currentThreadKey,
    );
  return openIsWaiting ? "Nothing else needs you" : "Nothing needs you";
}

/** "(2) E6 Code" while two threads are blocked on you, plain "E6 Code" with none. */
export function documentTitleWithBlockedCount(title: string, blockedCount: number): string {
  return blockedCount > 0 ? `(${blockedCount}) ${title}` : title;
}
