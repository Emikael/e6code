# Attention selector

What counts as "needs you" is decided in one place, [`threadAttention.ts`](../../packages/client-runtime/src/state/threadAttention.ts), and every surface that shows or counts it reads that selector: the Needs you section on web and mobile, the start screen, the tab title, the desktop dock badge, notifications, and "Go to next thread that needs you". Before it existed, the sidebar, the notifier and mobile each had their own "failed" rule, so a badge could count a thread the list did not show. Add a new surface by reading the selector, not by testing shell fields again. The rules themselves, and their tests, are in that file.

## Who owns which input

- **Blocked comes from the server.** Approvals, questions and failures are read from the thread shell (`hasPendingApprovals`, `hasPendingUserInput`, `session`, `latestTurn`), so every device agrees on them, and only blocked threads are counted. `pendingRequestSince` orders and ages blocked rows; it is optional on the wire, and clients fall back to `updatedAt` for servers that do not send it.
- **To review comes from the device.** A finished turn is "unseen" against this device's last visit (`lastVisitedAt` in [`apps/web/src/uiStateStore.ts`](../../apps/web/src/uiStateStore.ts)), which is not synced. Two devices can therefore disagree about To review, and a client without visit state has no To review tier. This is why To review is never counted.

## Copies that must stay in step

Two server-side rules ask the same question from the same fields without using the selector, because they run where client state does not exist:

- Push notifications and live activity derive a thread's phase in [`agentAwareness.ts`](../../packages/shared/src/agentAwareness.ts).
- The decider refuses to snooze a thread with a pending approval or question, and [`canSnooze`](../../packages/client-runtime/src/state/threadSettled.ts) is its client twin. Wrap up and "Snooze everything except this thread" rely on it to leave blocked threads in place.

When the meaning of blocked changes, change these with it, or a phone will be notified about a thread the sidebar does not list.
