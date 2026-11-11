import remarkParse from "remark-parse";
import { unified } from "unified";

// Pele lays out a diagram before its SVG is sanitized. Refuse resource and config syntax before
// that pass so untrusted sources (agent output, pull request descriptions, files) cannot initiate
// requests. Node metadata is YAML, whose escaped or aliased image keys cannot be checked
// lexically. (Ported from T3 Code.)
const UNSAFE_DIAGRAM_SOURCE =
  /%%\s*\{|^\s*---|<\/?[A-Za-z]|<[!?]|@\s*\{|\b(?:img|image)\s*:|url\s*\(|@import|(?:https?|data|blob|file):/im;

/** True when a Mermaid source must stay code rather than be handed to the renderer. */
export function isUnsafeMermaidSource(text: string): boolean {
  return UNSAFE_DIAGRAM_SOURCE.test(text);
}

export type MermaidMarkdownSegment =
  | { readonly kind: "markdown"; readonly markdown: string; readonly sourceOffset: number }
  | { readonly kind: "mermaid"; readonly code: string; readonly sourceOffset: number };

interface MarkdownNode {
  readonly type: string;
  readonly lang?: string | null;
  readonly value?: string;
  readonly position?: { readonly start: { offset?: number }; readonly end: { offset?: number } };
}

const parser = unified().use(remarkParse).freeze();

// The closing fence repeats the opener's character at least as many times; a fence that is still
// streaming has none and parses to the end of the text.
function isClosedFence(authored: string): boolean {
  const open = /^[ \t]*(`{3,}|~{3,})/.exec(authored)?.[1];
  const close = /\n[ \t]*(`{3,}|~{3,})[ \t\r]*$/.exec(authored)?.[1];
  return Boolean(open && close && open[0] === close[0] && close.length >= open.length);
}

/**
 * Splits out closed top-level ```mermaid fences so clients without a DOM can draw them as
 * diagrams between ordinary Markdown segments. Fences inside lists, quotes, or still streaming
 * stay in the Markdown.
 */
export function splitMermaidMarkdown(markdown: string): ReadonlyArray<MermaidMarkdownSegment> {
  if (!/(?:`{3,}|~{3,})[ \t]*mermaid\b/i.test(markdown)) {
    return [{ kind: "markdown", markdown, sourceOffset: 0 }];
  }
  const root = parser.parse(markdown) as { readonly children: ReadonlyArray<MarkdownNode> };
  const segments: MermaidMarkdownSegment[] = [];
  let cursor = 0;
  for (const node of root.children) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (
      node.type !== "code" ||
      node.lang?.toLowerCase() !== "mermaid" ||
      start === undefined ||
      end === undefined ||
      !isClosedFence(markdown.slice(start, end))
    ) {
      continue;
    }
    if (start > cursor) {
      segments.push({
        kind: "markdown",
        markdown: markdown.slice(cursor, start),
        sourceOffset: cursor,
      });
    }
    segments.push({ kind: "mermaid", code: node.value ?? "", sourceOffset: start });
    cursor = end;
  }
  if (cursor < markdown.length) {
    segments.push({ kind: "markdown", markdown: markdown.slice(cursor), sourceOffset: cursor });
  }
  return segments.length > 0 ? segments : [{ kind: "markdown", markdown, sourceOffset: 0 }];
}
