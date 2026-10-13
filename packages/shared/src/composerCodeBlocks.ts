export interface ComposerCodeBlock {
  readonly start: number;
  readonly end: number;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly closingStart: number | null;
  readonly fence: string;
  readonly language: string;
  readonly opening: string;
}

/** Source ranges are UTF-16 offsets, shared by web and native selections. */
export function collectComposerCodeBlocks(text: string): ComposerCodeBlock[] {
  const blocks: ComposerCodeBlock[] = [];
  let open: Omit<ComposerCodeBlock, "end" | "contentEnd" | "closingStart"> | null = null;
  let offset = 0;
  for (const line of text.split("\n")) {
    const body = line.endsWith("\r") ? line.slice(0, -1) : line;
    const lineEnd = offset + line.length;
    const next = Math.min(text.length, lineEnd + 1);
    if (open) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(body);
      if (close && close[1]![0] === open.fence[0] && close[1]!.length >= open.fence.length) {
        let contentEnd = offset;
        if (contentEnd > open.contentStart && text[contentEnd - 1] === "\n") contentEnd -= 1;
        if (contentEnd > open.contentStart && text[contentEnd - 1] === "\r") contentEnd -= 1;
        blocks.push({ ...open, end: lineEnd, contentEnd, closingStart: offset });
        open = null;
      }
    } else {
      const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(body);
      if (match && !(match[1]![0] === "`" && match[2]!.includes("`"))) {
        open = {
          start: offset,
          contentStart: next,
          fence: match[1]!,
          language: match[2]!.trim(),
          opening: text.slice(offset, next),
        };
      }
    }
    offset = next;
  }
  if (open) blocks.push({ ...open, end: text.length, contentEnd: text.length, closingStart: null });
  return blocks;
}

export function isComposerCodePosition(text: string, cursor: number): boolean {
  return collectComposerCodeBlocks(text).some(
    (block) => cursor > block.start && cursor <= block.end,
  );
}
