import { describe, expect, it } from "vite-plus/test";

import { isUnsafeMermaidSource } from "../chat/MermaidDiagram";

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
