# Parked thoughts and notes across devices

Parked thoughts and notes to self can be kept by an environment, so every client connected to it sees one list. Composer drafts parked with Mod+S are not: they can carry images and stay in the client that parked them.

## One list per environment

The list is a third orchestration aggregate, `parked`, with one id per environment (`PARKED_LIST_ID`). It is environment-scoped like projects and threads because an environment is the only shared store E6 Code has: there is no account that spans environments, and a note belongs to a thread, which already lives in one environment. A thought goes to its project's environment, or the primary one when it has no project. Clients that connect several environments show the lists side by side, keyed by environment.

Anyone paired with an environment can read its list. Thoughts and notes are personal, so a client keeps them on the device, new ones included, until the user accepts saving them to that environment, and asks once per environment. The answer is kept on the device (web: its own localStorage key; mobile: a file), and an environment that was not accepted is not even subscribed to. Mobile keeps nothing of its own, so before an answer it cannot park at all.

Rules live in [`apps/server/src/orchestration/parked.ts`](../../apps/server/src/orchestration/parked.ts). The clients' queue lives in [`packages/client-runtime/src/parked/parkedSync.ts`](../../packages/client-runtime/src/parked/parkedSync.ts).

## Nothing is lost in the move

- **Upload.** Once saving is accepted, a client uploads what it kept before (`parked.import`) with the entries' own ids. The server skips any id it holds or has removed, so two tabs or browsers uploading the same list keep one copy, and a stale copy cannot bring back a deleted thought or a cleared note. An entry is bound to the first environment it is uploaded to and is never uploaded to another, so a thought cannot land in two environments when the primary one changes. The client forgets its own copy only when the server's list shows the entry.
- **Offline.** Changes made while the environment is unreachable are kept in a queue on the device and shown at once, then sent in order, one at a time, when it is reachable again. The first queued change may already be on its way, so nothing is folded into it.
- **Refusals.** A change the server refuses, or one that cannot be encoded (longer than `PARKED_TEXT_MAX_CHARS`, say), leaves the queue so it never blocks the rest; any text it carried stays on the device and the user is told.
- **Conflicts.** Thoughts are last writer wins. A note edit carries the text it started from; if the note changed since, the server joins the two texts rather than replacing text that client never saw, the client says so, and a clear made from an old version is refused.
- **Tombstones.** Removed entries keep a row without their text for `PARKED_TOMBSTONE_MAX_AGE_DAYS`. A client sends `sentAt` with an entry an earlier upload already reached the server with; past that age such an entry, neither held nor remembered as removed, is skipped, so a device away longer than the tombstones last still cannot bring one back, and keeps its copy instead.

## Version skew

Servers advertise `parkedSync`. Clients subscribe to `orchestration.subscribeParked` and send `parked.*` commands only to servers that do, so an older server keeps working with a newer client, which simply keeps thoughts on the device. Parked events never reach the shell or thread streams, so older clients connected to a newer server never see an event type they cannot decode.
