# Parked thoughts and notes across devices

Parked thoughts and notes to self (F7) are kept by the environment, so every client connected to it sees one list. Composer drafts stashed with Mod+S are not: they can carry images and stay in the client that stashed them.

## One list per environment

The list is a third orchestration aggregate, `parked`, with one id per environment (`PARKED_LIST_ID`). It is environment-scoped like projects and threads because an environment is the only shared store E6 Code has: there is no account that spans environments, and a note belongs to a thread, which already lives in one environment. A thought goes to its project's environment, or the primary one when it has no project. Clients that connect several environments show the lists side by side, keyed by environment.

Rules live in [`apps/server/src/orchestration/parked.ts`](../../apps/server/src/orchestration/parked.ts). The clients' queue lives in [`packages/client-runtime/src/parked/parkedSync.ts`](../../packages/client-runtime/src/parked/parkedSync.ts).

## Nothing is lost in the move

- **Upload.** A client uploads what it kept before (`parked.import`) with the entries' own ids. The server skips any id it holds or has removed, so two tabs or browsers uploading the same list keep one copy, and a stale copy cannot bring back a deleted thought. The client forgets its own copy only when the server's list shows the entry.
- **Offline.** Changes go into a queue stored on the device and are shown at once. The queue is sent in order whenever that environment's list arrives, which happens on every reconnect. The op id is the command id, so a resend after a lost reply is recognised. A change the server refuses is dropped, except a thought it would not take: that comes back to the device instead of disappearing.
- **Conflicts.** Thoughts are last writer wins. A note edit carries the version it started from; if the note changed since, the server joins the two texts rather than replacing text that client never saw, and a clear made from an old version is refused.
- **Caps.** 200 thoughts and 200 notes per environment. Past a cap the server refuses and imports skip; nothing is evicted (decision 10).

## Version skew

Servers advertise `parkedSync`. Clients subscribe to `orchestration.subscribeParked` and send `parked.*` commands only to servers that do, so an older server keeps working with a newer client, which simply keeps thoughts on the device. Parked events never reach the shell or thread streams, so older clients connected to a newer server never see an event type they cannot decode.
