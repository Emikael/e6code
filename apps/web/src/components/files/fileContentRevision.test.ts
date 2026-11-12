import { describe, expect, it } from "vite-plus/test";

import { projectFileCacheKey, projectFileEditorCacheKey } from "./fileContentRevision";

describe("file cache identity", () => {
  it("changes for same-length edits", () => {
    expect(projectFileCacheKey("/repo", "file.json", "nodeVersion")).not.toBe(
      projectFileCacheKey("/repo", "file.json", "nodeVeasdrs"),
    );
  });

  it("keeps editor identity stable for locally edited contents", () => {
    const cacheKey = projectFileEditorCacheKey("local", "/repo", "file.json", "after", undefined);

    expect(
      projectFileEditorCacheKey("local", "/repo", "file.json", "after edit", {
        cacheKey,
        contents: "after edit",
      }),
    ).toBe(cacheKey);
  });

  it("rotates editor identity for external contents and environments", () => {
    const cacheKey = projectFileEditorCacheKey("local", "/repo", "file.json", "before", undefined);
    const editorFile = { cacheKey, contents: "before" };

    expect(
      projectFileEditorCacheKey("local", "/repo", "file.json", "external edit", editorFile),
    ).not.toBe(cacheKey);
    expect(projectFileEditorCacheKey("remote", "/repo", "file.json", "before", undefined)).not.toBe(
      cacheKey,
    );
  });

  it("does not hand Undo's restored contents the key that still holds the edit", () => {
    const original = projectFileEditorCacheKey("local", "/repo", "file.json", "before", undefined);
    // After an edit the editor keeps the original key for the edited text.
    const editorFile = { cacheKey: original, contents: "before, edited" };

    const restored = projectFileEditorCacheKey("local", "/repo", "file.json", "before", editorFile);
    expect(restored).not.toBe(original);
    // Once the editor shows the restored text under that key, the key holds still.
    expect(
      projectFileEditorCacheKey("local", "/repo", "file.json", "before", {
        cacheKey: restored,
        contents: "before",
      }),
    ).toBe(restored);
  });
});
