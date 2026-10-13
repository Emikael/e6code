import { describe, expect, it } from "vite-plus/test";
import { collectComposerCodeBlocks, isComposerCodePosition } from "./composerCodeBlocks.ts";

describe("composer code blocks", () => {
  it.each(["```", "````", "~~~"])("preserves content and language for %s fences", (fence) => {
    const text = `before 😀\n${fence}ts\n  $review\n@file\n${fence}\nafter`;
    const [block] = collectComposerCodeBlocks(text);
    expect(block?.language).toBe("ts");
    expect(text.slice(block!.contentStart, block!.contentEnd)).toBe("  $review\n@file");
    expect(text.slice(block!.start, block!.end)).toBe(`${fence}ts\n  $review\n@file\n${fence}`);
    expect(isComposerCodePosition(text, text.indexOf("$review") + 3)).toBe(true);
    expect(isComposerCodePosition(text, text.length)).toBe(false);
  });
  it("keeps an unfinished block through the end of the draft", () => {
    const [block] = collectComposerCodeBlocks("```ts\n$review");
    expect(block).toMatchObject({ contentStart: 6, contentEnd: 13, end: 13, closingStart: null });
  });
  it("ignores inline fences and shorter or mismatched closers", () => {
    expect(collectComposerCodeBlocks("use ``` inline")).toEqual([]);
    const text = "````\na\n```\n~~~\nb\n````";
    const [block] = collectComposerCodeBlocks(text);
    expect(text.slice(block!.contentStart, block!.contentEnd)).toBe("a\n```\n~~~\nb");
  });
  it("preserves CRLF opening markers without including the closing separator in content", () => {
    const text = "   ```js\r\n a\r\n   ```";
    const [block] = collectComposerCodeBlocks(text);
    expect(block?.opening).toBe("   ```js\r\n");
    expect(text.slice(block!.contentStart, block!.contentEnd)).toBe(" a");
  });
  it("keeps empty and adjacent blocks distinguishable", () => {
    expect(
      collectComposerCodeBlocks("```\n```\n~~~\n\n~~~").map(
        (block) => block.contentEnd - block.contentStart,
      ),
    ).toEqual([0, 0]);
  });
});
