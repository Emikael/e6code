import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  MessageId,
  ParkedEntryId,
  ThreadId,
  type OrchestrationParkedEntry,
} from "@e6tools/contracts";
import {
  collectAssistantCitations,
  serializeAssistantCitation,
} from "@e6tools/shared/assistantCitations";

import { removeLocalStorageItem } from "./hooks/useLocalStorage";

import {
  MAX_PARKED_THOUGHTS,
  MAX_STASH_ENTRIES,
  handlePromptStashStorageEvent,
  parkedEntryKind,
  selectThreadNote,
  PROMPT_STASH_STORAGE_KEY,
  MAX_STASH_ENTRY_ATTACHMENT_CHARS,
  PARKED_CACHE_STORAGE_KEY,
  readPromptStashStorageForTest,
  partitionStashAttachments,
  selectNextParkedSend,
  selectParkedFooter,
  selectParkedOffer,
  usePromptStashStore,
  writePromptStashStorageForTest,
  type PromptStashEntry,
} from "./promptStashStore";

function makeEntry(input: {
  id: string;
  prompt?: string;
  attachmentChars?: number;
}): PromptStashEntry {
  return {
    id: input.id,
    createdAt: "2026-07-24T12:00:00.000Z",
    prompt: input.prompt ?? `prompt ${input.id}`,
    attachments:
      input.attachmentChars !== undefined
        ? [
            {
              id: `${input.id}-img`,
              name: "shot.png",
              mimeType: "image/png",
              sizeBytes: input.attachmentChars,
              dataUrl: "x".repeat(input.attachmentChars),
            },
          ]
        : [],
    droppedImageNames: [],
  };
}

function thought(id: string): PromptStashEntry {
  return { ...makeEntry({ id, prompt: `thought ${id}` }), kind: "thought" };
}

function resetPromptStashStore() {
  usePromptStashStore.setState({ entries: [] });
  writePromptStashStorageForTest("");
  removeLocalStorageItem(PROMPT_STASH_STORAGE_KEY);
}

describe("partitionStashAttachments", () => {
  it("keeps attachments within the budget and reports dropped names in order", () => {
    const small = {
      id: "a",
      name: "small.png",
      mimeType: "image/png",
      sizeBytes: 10,
      dataUrl: "x".repeat(10),
    };
    const huge = {
      id: "b",
      name: "huge.png",
      mimeType: "image/png",
      sizeBytes: MAX_STASH_ENTRY_ATTACHMENT_CHARS,
      dataUrl: "x".repeat(MAX_STASH_ENTRY_ATTACHMENT_CHARS),
    };
    const alsoSmall = {
      id: "c",
      name: "also-small.png",
      mimeType: "image/png",
      sizeBytes: 10,
      dataUrl: "x".repeat(10),
    };
    const { kept, droppedNames } = partitionStashAttachments([small, huge, alsoSmall]);
    expect(kept.map((attachment) => attachment.id)).toEqual(["a", "c"]);
    expect(droppedNames).toEqual(["huge.png"]);
  });

  it("admits a single attachment that exactly fits the budget", () => {
    const exact = {
      id: "a",
      name: "exact.png",
      mimeType: "image/png",
      sizeBytes: MAX_STASH_ENTRY_ATTACHMENT_CHARS,
      dataUrl: "x".repeat(MAX_STASH_ENTRY_ATTACHMENT_CHARS),
    };
    const { kept, droppedNames } = partitionStashAttachments([exact]);
    expect(kept).toHaveLength(1);
    expect(droppedNames).toEqual([]);
  });
});

describe("promptStashStore", () => {
  beforeEach(() => {
    resetPromptStashStore();
  });

  afterEach(() => {
    resetPromptStashStore();
  });

  it("prepends entries so the newest stash is first", () => {
    const store = usePromptStashStore.getState();
    store.stashEntry(makeEntry({ id: "first" }));
    store.stashEntry(makeEntry({ id: "second" }));
    const entries = usePromptStashStore.getState().entries;
    expect(entries.map((entry) => entry.id)).toEqual(["second", "first"]);
  });

  it("restores citations and bound comments from a persisted stash", () => {
    const citation = {
      version: 1 as const,
      environmentId: EnvironmentId.make("remote-source"),
      threadId: ThreadId.make("source-thread"),
      messageId: MessageId.make("source-message"),
      text: "A quote to revisit later.",
      comment: "Revisit this tomorrow.\nCheck whether the example still applies.",
      start: 0,
      end: 24,
      prefix: "",
      suffix: " Next.",
    };
    const prompt = `Revisit ${serializeAssistantCitation(citation)}`;
    writePromptStashStorageForTest(
      JSON.stringify({
        version: 2,
        state: { entries: [makeEntry({ id: "citation-stash", prompt })] },
      }),
    );
    const restored = usePromptStashStore.getState().takeEntry("citation-stash").entry;
    expect(restored?.prompt).toBe(prompt);
    expect(
      collectAssistantCitations(restored?.prompt ?? "").map((entry) => entry.citation),
    ).toEqual([citation]);
    expect(usePromptStashStore.getState().takeEntry("citation-stash").entry).toBeNull();
  });

  it("refuses a draft past the cap instead of evicting the oldest", () => {
    const store = usePromptStashStore.getState();
    for (let index = 0; index < MAX_STASH_ENTRIES; index += 1) {
      expect(store.stashEntry(makeEntry({ id: `entry-${index}` })).refused).toBe(false);
    }
    const result = store.stashEntry(makeEntry({ id: "overflow" }));
    expect(result).toEqual({ refused: true, written: false, durable: false });
    const entries = usePromptStashStore.getState().entries;
    expect(entries).toHaveLength(MAX_STASH_ENTRIES);
    expect(entries.some((entry) => entry.id === "entry-0")).toBe(true);
    expect(entries.some((entry) => entry.id === "overflow")).toBe(false);
  });

  it("keeps a separate cap of 200 for thoughts and refuses the 201st", () => {
    const store = usePromptStashStore.getState();
    for (let index = 0; index < MAX_STASH_ENTRIES; index += 1) {
      store.stashEntry(makeEntry({ id: `draft-${index}` }));
    }
    for (let index = 0; index < MAX_PARKED_THOUGHTS; index += 1) {
      expect(store.stashEntry(thought(`thought-${index}`)).refused).toBe(false);
    }
    expect(store.stashEntry(thought("one-too-many")).refused).toBe(true);
    // Thoughts never count against the drafts, whose images keep their own budget.
    expect(usePromptStashStore.getState().entries).toHaveLength(
      MAX_STASH_ENTRIES + MAX_PARKED_THOUGHTS,
    );
  });

  it("round-trips kinds and their keys through storage", () => {
    writePromptStashStorageForTest(
      JSON.stringify({
        version: 2,
        state: {
          entries: [
            { ...makeEntry({ id: "t" }), kind: "thought", projectKey: "env:project" },
            { ...makeEntry({ id: "n" }), kind: "note", threadKey: "env:thread" },
            { ...makeEntry({ id: "p" }), kind: "thought", pinnedFor: "2026-11-12" },
          ],
        },
      }),
    );
    const entries = usePromptStashStore.getState().entries;
    expect(entries.map((entry) => [entry.id, parkedEntryKind(entry)])).toEqual([
      ["t", "thought"],
      ["n", "note"],
      ["p", "thought"],
    ]);
    expect(entries[0]?.projectKey).toBe("env:project");
    expect(entries[1]?.threadKey).toBe("env:thread");
    expect(entries[2]?.pinnedFor).toBe("2026-11-12");
  });

  it("reads v2 entries written before kinds existed as drafts", () => {
    writePromptStashStorageForTest(
      JSON.stringify({
        version: 2,
        state: { entries: [makeEntry({ id: "old", attachmentChars: 8 })] },
      }),
    );
    const [entry] = usePromptStashStore.getState().entries;
    expect(entry && parkedEntryKind(entry)).toBe("draft");
    expect(entry?.attachments).toHaveLength(1);
  });

  it("keeps one note per thread, replaced on edit and removed when emptied", () => {
    const store = usePromptStashStore.getState();
    store.setThreadNote("env:thread", "Check dark mode on Android after this.");
    store.setThreadNote("env:thread", "  Check dark mode on iOS too.  ");
    let entries = usePromptStashStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(selectThreadNote(entries, "env:thread")?.prompt).toBe("Check dark mode on iOS too.");
    store.setThreadNote("env:thread", "   ");
    entries = usePromptStashStore.getState().entries;
    expect(selectThreadNote(entries, "env:thread")).toBeNull();
  });

  it("keeps one thought pinned per day, and unpinning leaves it parked", () => {
    const store = usePromptStashStore.getState();
    store.setPinnedThought("2026-11-13", "Check the mobile tokens.", "env:project");
    store.setPinnedThought("2026-11-13", "  Check the mobile tokens on a device.  ", null);
    let entries = usePromptStashStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "thought",
      pinnedFor: "2026-11-13",
      prompt: "Check the mobile tokens on a device.",
    });
    store.unpinEntry(entries[0]!.id);
    entries = usePromptStashStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.pinnedFor).toBeUndefined();
    store.setPinnedThought("2026-11-14", "Tomorrow", null);
    store.setPinnedThought("2026-11-14", "  ", null);
    expect(usePromptStashStore.getState().entries).toHaveLength(1);
  });

  it("keeps what another tab parked since this tab last read the list", () => {
    const store = usePromptStashStore.getState();
    store.stashEntry(thought("mine"));
    // Another tab of the origin parks a thought and writes the whole list.
    writePromptStashStorageForTest(
      JSON.stringify({ version: 2, state: { entries: [thought("theirs"), thought("mine")] } }),
      { rehydrate: false },
    );
    store.stashEntry(thought("later"));
    expect(usePromptStashStore.getState().entries.map((entry) => entry.id)).toEqual([
      "later",
      "theirs",
      "mine",
    ]);
    store.setThreadNote("env:thread", "A note");
    store.takeEntry("mine");
    writePromptStashStorageForTest(JSON.stringify({ version: 2, state: { entries: [] } }), {
      rehydrate: false,
    });
    // A later write starts from the stored list, not this tab's stale copy.
    store.stashEntry(thought("fresh"));
    expect(usePromptStashStore.getState().entries.map((entry) => entry.id)).toEqual(["fresh"]);
  });

  it("keeps a note and a pinned thought another tab wrote through this tab's next write", () => {
    const store = usePromptStashStore.getState();
    store.stashEntry(thought("mine"));
    writePromptStashStorageForTest(
      JSON.stringify({
        version: 2,
        state: {
          entries: [
            {
              ...makeEntry({ id: "their-note", prompt: "Their note" }),
              kind: "note",
              threadKey: "env:t",
            },
            { ...thought("their-pin"), pinnedFor: "2026-11-13" },
            thought("mine"),
          ],
        },
      }),
      { rehydrate: false },
    );
    store.stashEntry(thought("later"));
    const entries = usePromptStashStore.getState().entries;
    expect(selectThreadNote(entries, "env:t")?.prompt).toBe("Their note");
    expect(entries.find((entry) => entry.id === "their-pin")?.pinnedFor).toBe("2026-11-13");
    expect(entries.map((entry) => entry.id)).toEqual(["later", "their-note", "their-pin", "mine"]);
  });

  it("rehydrates from another tab's storage event, leaving its pending images alone", () => {
    writePromptStashStorageForTest(
      JSON.stringify({
        version: 2,
        state: { entries: [{ ...makeEntry({ id: "theirs" }), pendingImageCount: 2 }] },
      }),
      { rehydrate: false },
    );
    handlePromptStashStorageEvent("unrelated-key");
    expect(usePromptStashStore.getState().entries).toEqual([]);
    handlePromptStashStorageEvent(PROMPT_STASH_STORAGE_KEY);
    const [entry] = usePromptStashStore.getState().entries;
    expect(entry?.id).toBe("theirs");
    // That tab may still be encoding; only a fresh load settles orphans.
    expect(entry?.pendingImageCount).toBe(2);
    expect(entry?.unreadableImageNames).toBeUndefined();
  });

  it("keeps this tab's own pending image count across a re-read", () => {
    const store = usePromptStashStore.getState();
    store.stashEntry({ ...makeEntry({ id: "encoding" }), pendingImageCount: 1 });
    store.stashEntry(thought("other"));
    const encoding = usePromptStashStore
      .getState()
      .entries.find((entry) => entry.id === "encoding");
    expect(encoding?.pendingImageCount).toBe(1);
    expect(encoding?.unreadableImageNames).toBeUndefined();
    store.finalizeEntryImages("encoding", {
      attachments: [],
      droppedImageNames: [],
      unreadableImageNames: [],
    });
    expect(
      usePromptStashStore.getState().entries.find((entry) => entry.id === "encoding")
        ?.pendingImageCount,
    ).toBe(0);
  });

  it("puts an entry back where it was on Undo", () => {
    const store = usePromptStashStore.getState();
    store.stashEntry(thought("a"));
    store.stashEntry(thought("b"));
    store.stashEntry(thought("c"));
    const { entry } = store.takeEntry("b");
    store.restoreEntry(entry!, 1);
    expect(usePromptStashStore.getState().entries.map((candidate) => candidate.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  // This test environment has no `localStorage`, so the store runs on its
  // in-memory fallback — the exact "kept for this session, gone on reload"
  // case the composer must distinguish from an outright write failure.
  it("distinguishes a memory-only write (written, not durable) from a failed one", () => {
    const store = usePromptStashStore.getState();
    const result = store.stashEntry(makeEntry({ id: "memory-only" }));
    expect(result.written).toBe(true);
    expect(result.durable).toBe(false);
    expect(usePromptStashStore.getState().entries.map((entry) => entry.id)).toEqual([
      "memory-only",
    ]);
  });

  it("takeEntry removes and returns the entry; second take returns null", () => {
    const store = usePromptStashStore.getState();
    store.stashEntry(makeEntry({ id: "keep" }));
    store.stashEntry(makeEntry({ id: "take" }));
    expect(store.takeEntry("take").entry?.id).toBe("take");
    expect(store.takeEntry("take").entry).toBeNull();
    const entries = usePromptStashStore.getState().entries;
    expect(entries.map((entry) => entry.id)).toEqual(["keep"]);
  });

  it("finalizeEntryImages attaches images and clears the pending count", () => {
    const store = usePromptStashStore.getState();
    store.stashEntry({ ...makeEntry({ id: "pending" }), pendingImageCount: 2 });

    const { attached } = store.finalizeEntryImages("pending", {
      attachments: [
        {
          id: "img-1",
          name: "a.webp",
          mimeType: "image/webp",
          sizeBytes: 10,
          dataUrl: "data:image/webp;base64,AAAA",
        },
      ],
      droppedImageNames: ["big.png"],
      unreadableImageNames: [],
    });

    expect(attached).toBe(true);
    const entry = usePromptStashStore.getState().entries[0];
    expect(entry?.attachments).toHaveLength(1);
    expect(entry?.droppedImageNames).toEqual(["big.png"]);
    expect(entry?.pendingImageCount).toBe(0);
  });

  it("takeEntry returns images and drop metadata finalized after a menu snapshot", () => {
    const store = usePromptStashStore.getState();
    store.stashEntry({ ...makeEntry({ id: "pending-restore" }), pendingImageCount: 1 });
    const menuSnapshot = usePromptStashStore.getState().entries[0];
    expect(menuSnapshot?.attachments).toEqual([]);

    store.finalizeEntryImages("pending-restore", {
      attachments: [
        {
          id: "img-finalized",
          name: "finalized.webp",
          mimeType: "image/webp",
          sizeBytes: 12,
          dataUrl: "data:image/webp;base64,BBBB",
        },
      ],
      droppedImageNames: ["too-large.png"],
      unreadableImageNames: ["unreadable.png"],
    });

    const { entry: taken } = store.takeEntry("pending-restore");
    expect(taken).not.toBe(menuSnapshot);
    expect(taken).toMatchObject({
      attachments: [
        {
          id: "img-finalized",
          name: "finalized.webp",
        },
      ],
      droppedImageNames: ["too-large.png"],
      unreadableImageNames: ["unreadable.png"],
      pendingImageCount: 0,
    });
  });

  it("preserves uploaded file references without storing file contents", () => {
    const store = usePromptStashStore.getState();
    const file = {
      id: "file-1",
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
      attachmentId: "pending-report-pdf",
      environmentId: EnvironmentId.make("environment-1"),
    };

    store.stashEntry({ ...makeEntry({ id: "with-file" }), files: [file] });
    store.finalizeEntryImages("with-file", {
      attachments: [],
      droppedImageNames: [],
      unreadableImageNames: [],
    });

    expect(usePromptStashStore.getState().entries[0]?.files).toEqual([file]);
  });

  it("finalizeEntryImages reports false when the entry was already taken", () => {
    const store = usePromptStashStore.getState();
    store.stashEntry({ ...makeEntry({ id: "racing" }), pendingImageCount: 1 });
    // Restored (or deleted) while its images were still encoding.
    store.takeEntry("racing");

    const { attached } = store.finalizeEntryImages("racing", {
      attachments: [],
      droppedImageNames: [],
      unreadableImageNames: [],
    });

    expect(attached).toBe(false);
  });

  it("settles a pending count left behind by a crashed or closed session", () => {
    writePromptStashStorageForTest(
      JSON.stringify({
        version: 2,
        state: {
          entries: [{ ...makeEntry({ id: "orphan" }), pendingImageCount: 2 }],
        },
      }),
    );

    // Hydration must settle the stale count, or the entry would stay stuck
    // showing "saving…" with images that no longer exist anywhere.
    const entry = usePromptStashStore.getState().entries[0];
    expect(entry?.pendingImageCount).toBe(0);
    expect(entry?.unreadableImageNames).toHaveLength(2);
  });

  it("ignores an unreadable v1 payload seeded under the current key", () => {
    // The v1 shape (per-provider queues) does not decode as v2; hydration
    // must fall back to an empty stash rather than throw.
    writePromptStashStorageForTest(
      JSON.stringify({
        version: 1,
        state: { queuesByScopeKey: { "provider:claudeAgent": [] } },
      }),
    );
    expect(usePromptStashStore.getState().entries).toEqual([]);
  });
});

describe("prompt stash context records", () => {
  it("keeps the records behind a stashed prompt's chips", () => {
    const store = usePromptStashStore.getState();
    const records = [
      {
        version: 1 as const,
        contextId: "ctx-1" as never,
        kind: "terminal" as const,
        label: "Terminal 1 line 4",
        terminalId: "default",
        terminalLabel: "Terminal 1",
        lineStart: 4,
        lineEnd: 4,
        text: "boom",
      },
    ];
    store.stashEntry({
      id: "entry-records",
      createdAt: "2026-01-01T00:00:00.000Z",
      prompt: "see [Terminal 1 line 4](e6-context://v1/terminal/ctx-1)",
      attachments: [],
      droppedImageNames: [],
      records,
    });
    const taken = usePromptStashStore.getState().takeEntry("entry-records");
    expect(taken.entry?.records).toEqual(records);
  });
});

describe("Parked list synced with an environment", () => {
  const ENV = "env-1";
  const OTHER = "env-2";
  const serverThought = (id: string, text = id): OrchestrationParkedEntry => ({
    id: ParkedEntryId.make(id),
    kind: "thought",
    text,
    projectId: null,
    threadId: null,
    pinnedFor: null,
    createdAt: "2026-11-12T09:00:00.000Z",
    updatedAt: "2026-11-12T09:00:00.000Z",
  });
  const serverNote = (
    text: string,
    updatedAt = "2026-11-12T09:30:00.000Z",
  ): OrchestrationParkedEntry => ({
    ...serverThought("note:thread-1", text),
    id: ParkedEntryId.make("note:thread-1"),
    kind: "note" as const,
    threadId: ThreadId.make("thread-1"),
    updatedAt,
  });
  const list = (...entries: OrchestrationParkedEntry[]) => ({
    entries,
    removedEntryIds: [],
  });
  const store = () => usePromptStashStore.getState();
  const nextSend = (environmentId = ENV, uploaded = new Set<string>()) =>
    selectNextParkedSend(store(), environmentId, uploaded);
  /** Stands in for the coordinator sending the first queued change and the server answering. */
  const answerFirstOp = (outcome: "accepted" | "refused", reason?: string) => {
    const next = nextSend();
    if (next?.kind !== "op") throw new Error("nothing queued");
    return store().settleParkedOp(next.op.opId, outcome, reason);
  };

  beforeEach(() => {
    resetPromptStashStore();
    store().setPrimaryEnvironmentId(ENV);
    store().setAvailableEnvironmentIds([ENV]);
  });

  afterEach(() => {
    store().setPrimaryEnvironmentId(null);
    resetPromptStashStore();
  });

  it("sends nothing, new thoughts included, until the user accepts, then uploads once", () => {
    store().stashEntry(thought("old"));
    store().stashEntry(makeEntry({ id: "draft" }));
    store().setThreadNote(`${ENV}:thread-1`, "Check Android");
    expect(nextSend()).toBeNull();
    expect(store().stored.parkedOps).toEqual([]);
    expect(selectParkedOffer(store())).toEqual({ environmentId: ENV, thoughts: 1, notes: 1 });

    store().acceptParkedSync(ENV);
    expect(selectParkedOffer(store())).toBeNull();
    const upload = nextSend();
    expect(upload?.kind === "import" && upload.entries.map((entry) => entry.id).sort()).toEqual(
      ["old", expect.any(String)].sort(),
    );
    // Still listed, and still here, while the upload is on its way.
    store().receiveParkedList(ENV, list());
    expect(store().entries.map((entry) => entry.id)).toContain("old");
    store().receiveParkedList(ENV, list(serverThought("old"), serverNote("Check Android")));
    expect(store().stored.entries.map((entry) => entry.id)).toEqual(["draft"]);
    expect(store().entries.filter((entry) => entry.id === "old")).toHaveLength(1);
    // From now on a new thought goes there.
    store().stashEntry(thought("new"));
    expect(nextSend()).toMatchObject({ kind: "op", op: { kind: "add", entryId: "new" } });
  });

  it("keeps everything here when declined, asks no more, and can be asked again", () => {
    store().stashEntry(thought("mine"));
    store().declineParkedSync(ENV);
    expect(selectParkedOffer(store())).toBeNull();
    store().stashEntry(thought("later"));
    expect(nextSend()).toBeNull();
    expect(store().stored.entries.map((entry) => entry.id)).toEqual(["later", "mine"]);
    expect(selectParkedFooter(store())).toMatchObject({ savedOn: [], saveLater: [ENV] });
    store().reopenParkedOffer(ENV);
    expect(selectParkedOffer(store())).toMatchObject({ environmentId: ENV, thoughts: 2 });
  });

  it("keeps the answer across a reload", () => {
    store().acceptParkedSync(ENV);
    store().declineParkedSync(OTHER);
    usePromptStashStore.setState({ consents: {} });
    handlePromptStashStorageEvent(null);
    expect(store().consents).toEqual({ [ENV]: "accepted", [OTHER]: "declined" });
  });

  it("uploads a thought to one environment only, even when the primary changes", () => {
    store().setAvailableEnvironmentIds([ENV, OTHER]);
    store().stashEntry({ ...thought("in-b"), projectKey: `${OTHER}:project-b` });
    store().stashEntry(thought("no-project"));
    store().acceptParkedSync(ENV);
    const upload = nextSend(ENV);
    const ids = upload?.kind === "import" ? upload.entries.map((entry) => entry.id) : [];
    // A thought whose project is in another environment never goes to the primary.
    expect(ids).toEqual(["no-project"]);
    store().markParkedUpload(ENV, ids, "sending");
    // The import is still on its way when the primary moves and B is accepted.
    store().setPrimaryEnvironmentId(OTHER);
    store().acceptParkedSync(OTHER);
    const toB = nextSend(OTHER);
    expect(toB?.kind === "import" && toB.entries.map((entry) => entry.id)).toEqual(["in-b"]);
    // B's list arriving does not touch what is bound to A; A's list forgets it.
    store().receiveParkedList(OTHER, list());
    expect(store().stored.entries.map((entry) => entry.id)).toContain("no-project");
    store().receiveParkedList(ENV, list(serverThought("no-project")));
    expect(store().stored.entries.map((entry) => entry.id)).toEqual(["in-b"]);
  });

  it("queues a thought parked offline and sends it, in order, once the environment is back", () => {
    store().acceptParkedSync(ENV);
    store().setAvailableEnvironmentIds([]);
    store().stashEntry(thought("offline"));
    store().stashEntry(thought("offline-2"));
    // Shown at once, though nothing can go yet.
    expect(store().entries.map((entry) => entry.id)).toEqual(["offline-2", "offline"]);
    expect(nextSend()).toBeNull();
    store().setAvailableEnvironmentIds([ENV]);
    expect(selectParkedFooter(store()).waiting).toBe(2);
    expect(nextSend()).toMatchObject({ kind: "op", op: { entryId: "offline" } });
    expect(answerFirstOp("accepted")).toBeNull();
    expect(nextSend()).toMatchObject({ kind: "op", op: { entryId: "offline-2" } });
    answerFirstOp("accepted");
    store().receiveParkedList(ENV, list(serverThought("offline"), serverThought("offline-2")));
    expect(store().stored.parkedOps).toEqual([]);
    expect(
      store()
        .entries.map((entry) => entry.id)
        .sort(),
    ).toEqual(["offline", "offline-2"]);
  });

  it("keeps a refused thought here, says so, and lets the next change through", () => {
    store().acceptParkedSync(ENV);
    store().receiveParkedList(ENV, list());
    store().stashEntry(thought("refused"));
    store().stashEntry(thought("next"));
    expect(answerFirstOp("refused")).toMatchObject({ title: "Could not save this thought" });
    expect(store().stored.entries.map((entry) => entry.id)).toEqual(["refused"]);
    expect(nextSend()).toMatchObject({ kind: "op", op: { entryId: "next" } });
    expect(selectParkedFooter(store())).toMatchObject({ waiting: 1, keptHere: 1 });
    // Tried once more only after the queue is empty, and with when it was first answered.
    answerFirstOp("accepted");
    const retry = nextSend();
    expect(retry).toMatchObject({ kind: "import", entries: [{ id: "refused" }] });
    expect(retry?.kind === "import" && retry.entries[0]?.sentAt).toEqual(expect.any(String));
    expect(nextSend(ENV, new Set(["refused"]))).toBeNull();
  });

  it("keeps a thought over the length limit here instead of blocking the queue", () => {
    store().acceptParkedSync(ENV);
    // Queued by a build without the limit: refused before it is sent.
    writePromptStashStorageForTest(
      JSON.stringify({
        version: 2,
        state: {
          entries: [],
          parkedOps: [
            {
              kind: "add",
              opId: "too-long",
              environmentId: ENV,
              entryId: "long",
              text: "x".repeat(5_000),
              projectId: null,
              pinnedFor: null,
              createdAt: "2026-11-12T09:00:00.000Z",
            },
          ],
        },
      }),
    );
    store().stashEntry(thought("short"));
    expect(selectParkedFooter(store()).waiting).toBe(1);
    expect(answerFirstOp("refused", "It is longer than 1,000 characters.")).toMatchObject({
      description: "It is longer than 1,000 characters. It is kept in this browser.",
    });
    expect(store().stored.entries.map((entry) => entry.prompt.length)).toEqual([5_000]);
    expect(nextSend()).toMatchObject({ kind: "op", op: { entryId: "short" } });
    // A thought too long to send is kept here rather than queued.
    store().stashEntry({ ...thought("pasted"), prompt: "y".repeat(1_500) });
    expect(store().stored.parkedOps.map((op) => op.kind === "add" && op.entryId)).toEqual([
      "short",
    ]);
  });

  it("hides a deleted synced thought until the server answers, and Undo sends nothing", () => {
    store().acceptParkedSync(ENV);
    store().receiveParkedList(ENV, list(serverThought("first"), serverThought("a")));
    store().takeEntry("first");
    const index = store().entries.findIndex((entry) => entry.id === "a");
    const { entry } = store().takeEntry("a");
    expect(store().entries).toEqual([]);
    store().restoreEntry(entry!, index);
    expect(store().entries.map((candidate) => candidate.id)).toEqual(["a"]);
    expect(store().stored.parkedOps).toEqual([
      expect.objectContaining({ kind: "remove", entryId: "first" }),
      expect.objectContaining({ kind: "update", entryId: "a", text: "a" }),
    ]);
  });

  it("edits a synced note from the text shown, and a second edit from the first one's", () => {
    store().acceptParkedSync(ENV);
    const threadKey = `${ENV}:thread-1`;
    store().receiveParkedList(ENV, list(serverNote("A")));
    store().setThreadNote(threadKey, "A plus");
    // The first edit was sent and its reply lost; the user edits again.
    store().setThreadNote(threadKey, "A plus more");
    expect(selectThreadNote(store().entries, threadKey)?.prompt).toBe("A plus more");
    expect(
      store().stored.parkedOps.map((op) => op.kind === "note" && [op.text, op.baseText]),
    ).toEqual([
      ["A plus", "A"],
      ["A plus more", "A plus"],
    ]);
  });

  it("says when a note edit was joined with one from another device", () => {
    store().acceptParkedSync(ENV);
    const threadKey = `${ENV}:thread-1`;
    store().receiveParkedList(ENV, list(serverNote("Mine")));
    store().setThreadNote(threadKey, "Mine, edited");
    store().receiveParkedList(
      ENV,
      list(serverNote("Theirs\n\nMine, edited", "2026-11-12T10:00:00.000Z")),
    );
    expect(answerFirstOp("accepted")).toEqual({
      type: "info",
      title: "This note changed on another device. Both versions are kept.",
    });
  });

  it("keeps a refused note's text here and shows it, and says why a clear did not happen", () => {
    store().acceptParkedSync(ENV);
    const threadKey = `${ENV}:thread-1`;
    store().receiveParkedList(ENV, list(serverNote("Server")));
    store().setThreadNote(threadKey, "Mine");
    expect(answerFirstOp("refused")).toMatchObject({ title: "Could not save this note" });
    expect(selectThreadNote(store().entries, threadKey)?.prompt).toBe("Mine");
    store().setThreadNote(threadKey, "");
    expect(answerFirstOp("refused")).toMatchObject({
      title: "This note changed on another device, so it was not cleared.",
    });
  });

  it("copies the environment's list here when the user stops saving there", () => {
    store().acceptParkedSync(ENV);
    store().receiveParkedList(ENV, list(serverThought("kept"), serverNote("A note")));
    store().declineParkedSync(ENV);
    expect(store().stored.parkedServer).toEqual({});
    expect(store().entries.map((entry) => [entry.id, entry.environmentId])).toContainEqual([
      "kept",
      undefined,
    ]);
    expect(selectThreadNote(store().entries, `${ENV}:thread-1`)?.prompt).toBe("A note");
    expect(nextSend()).toBeNull();
  });

  it("keeps the environment's list apart from drafts in storage", () => {
    store().acceptParkedSync(ENV);
    store().receiveParkedList(ENV, list(serverThought("cached")));
    expect(readPromptStashStorageForTest(PROMPT_STASH_STORAGE_KEY)).not.toContain("cached");
    expect(readPromptStashStorageForTest(PARKED_CACHE_STORAGE_KEY)).toContain("cached");
  });
});
