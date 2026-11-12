import { describe, expect, it } from "vite-plus/test";

import {
  fileLinesText,
  withFileSelectionBar,
  withoutFileSelectionBar,
} from "./fileCommentAnnotations";

describe("the selection bar under selected lines", () => {
  it("copies exactly the selected lines", () => {
    expect(fileLinesText("a\nb\nc\nd", 2, 3)).toBe("b\nc");
    expect(fileLinesText("a\nb", 2, 2)).toBe("b");
  });

  it("sits under the last line beside any comment there, and is never kept", () => {
    const comment = {
      lineNumber: 3,
      metadata: {
        entries: [{ id: "c1", kind: "comment" as const, startLine: 3, endLine: 3, text: "hi" }],
      },
    };
    const shown = withFileSelectionBar([comment], 2, 3);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.metadata.entries.map((entry) => entry.kind)).toEqual(["comment", "selection"]);
    expect(withoutFileSelectionBar(shown)).toEqual([comment]);
    expect(withoutFileSelectionBar(withFileSelectionBar([], 5, 7))).toEqual([]);
  });
});
