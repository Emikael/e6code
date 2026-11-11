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
 * the open one, or says "Nothing needs you".
 */
export function goToNextThreadThatNeedsYou(input: {
  readonly attention: ThreadAttention<EnvironmentThreadShell>;
  readonly currentThreadKey: string | null;
  readonly navigate: (options: {
    to: "/$environmentId/$threadId";
    params: ReturnType<typeof buildThreadRouteParams>;
  }) => unknown;
}): void {
  const target = nextNeedsYouTarget(input.attention, input.currentThreadKey);
  if (target === null) {
    toastManager.add(stackedThreadToast({ type: "info", title: "Nothing needs you" }));
    return;
  }
  void input.navigate({
    to: "/$environmentId/$threadId",
    params: buildThreadRouteParams(scopeThreadRef(target.thread.environmentId, target.thread.id)),
  });
}

/** "(2) E6 Code" while two threads are blocked on you, plain "E6 Code" with none. */
export function documentTitleWithBlockedCount(title: string, blockedCount: number): string {
  return blockedCount > 0 ? `(${blockedCount}) ${title}` : title;
}
