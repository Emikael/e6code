import { describe, expect, it } from "vite-plus/test";

import { isUnsafeMermaidSource, splitMermaidMarkdown } from "./mermaidMarkdown.ts";

describe("splitMermaidMarkdown", () => {
  it("returns one markdown segment when there is no mermaid fence", () => {
    expect(splitMermaidMarkdown("Hello\n\n```ts\nconst a = 1;\n```\n")).toEqual([
      { kind: "markdown", markdown: "Hello\n\n```ts\nconst a = 1;\n```\n", sourceOffset: 0 },
    ]);
  });

  it("splits closed top-level fences out between markdown", () => {
    const text = "Before\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nAfter";
    const segments = splitMermaidMarkdown(text);
    expect(segments.map((segment) => segment.kind)).toEqual(["markdown", "mermaid", "markdown"]);
    expect(segments[1]).toMatchObject({ kind: "mermaid", code: "flowchart LR\n  A --> B" });
    expect(segments[2]).toMatchObject({ kind: "markdown", markdown: "\n\nAfter" });
  });

  it("leaves a streaming fence and nested fences in the markdown", () => {
    expect(splitMermaidMarkdown("```mermaid\nflowchart LR\n  A -->")).toHaveLength(1);
    expect(splitMermaidMarkdown("- item\n\n  ```mermaid\n  flowchart LR\n  ```\n")).toHaveLength(1);
  });
});

describe("isUnsafeMermaidSource", () => {
  it("allows plain diagrams", () => {
    expect(isUnsafeMermaidSource("flowchart LR\n  A --> B\n  B --> C")).toBe(false);
  });

  it.each([
    "%%{init: {'theme': 'dark'}}%%\nflowchart LR\n A --> B",
    "---\ntitle: x\n---\nflowchart LR\n A --> B",
    'flowchart LR\n A["<img src=x>"] --> B',
    "flowchart LR\n A@{ img: 'x.png' }",
    "flowchart LR\n click A https://example.com",
    "classDef a fill:url(#x)",
  ])("refuses resource, markup, or config syntax: %s", (source) => {
    expect(isUnsafeMermaidSource(source)).toBe(true);
  });
});
