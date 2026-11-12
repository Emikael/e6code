# Parked thoughts and notes across devices

Parked thoughts and notes to self can be kept by an environment, so every client connected to it sees one list. Composer drafts parked with Mod+S are not: they can carry images and stay in the client that parked them.

## One list per environment

The list is a third orchestration aggregate, `parked`, with one id per environment (`PARKED_LIST_ID`). It is environment-scoped like projects and threads because an environment is the only shared store E6 Code has: there is no account that spans environments, and a note belongs to a thread, which already lives in one environment. A thought goes to its project's environment, or the primary one when it has no project. Clients that connect several environments show the lists side by side, keyed by environment.

Anyone paired with an environment can read its list. Thoughts and notes are personal, so a client keeps them on the device until the user accepts saving them to that environment, and asks once per environment.

Rules live in [`apps/server/src/orchestration/parked.ts`](../../apps/server/src/orchestration/parked.ts). The clients' queue lives in [`packages/client-runtime/src/parked/parkedSync.ts`](../../packages/client-runtime/src/parked/parkedSync.ts).

## Nothing is lost in the move

- **Upload.** Once saving is accepted, a client uploads what it kept before (`parked.import`) with the entries' own ids. The server skips any id it holds or has removed, so two tabs or browsers uploading the same list keep one copy, and a stale copy cannot bring back a deleted thought. The client forgets its own copy only when the server's list shows the entry.
- **Offline.** Changes made while the environment is unreachable are kept in a queue on the device and shown at once, then sent in order when it is reachable again.
- **Conflicts.** Thoughts are last writer wins. A note edit carries the version it started from; if the note changed since, the server joins the two texts rather than replacing text that client never saw, and a clear made from an old version is refused.

## Version skew

Servers advertise `parkedSync`. Clients subscribe to `orchestration.subscribeParked` and send `parked.*` commands only to servers that do, so an older server keeps working with a newer client, which simply keeps thoughts on the device. Parked events never reach the shell or thread streams, so older clients connected to a newer server never see an event type they cannot decode.
