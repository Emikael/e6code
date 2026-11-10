import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { describe, expect, it } from "vite-plus/test";

import { markdownMathKind } from "./components/ChatMarkdown";

// Same plugin order and options as chat, so this checks the tokenizer chat actually uses.
const render = (text: string) =>
  renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}>
      {text}
    </ReactMarkdown>,
  );

describe("chat math tokenizer", () => {
  it("marks backslash and double-dollar formulas", () => {
    expect(render("Energy \\(E = mc^2\\) here")).toContain('class="language-math math-inline"');
    expect(render("Energy $$E = mc^2$$ here")).toContain("language-math");
    expect(render("$$\n\\int_0^1 x\\,dx\n$$")).toContain("math-display");
    expect(render("\\[\nx^2\n\\]")).toContain("language-math");
  });

  it("leaves single dollars as text: prices and $skill mentions", () => {
    const html = render("It costs $5 and $10 per seat. Use $2spec with a $20k budget.");
    expect(html).not.toContain("language-math");
    expect(html).toContain("$5 and $10");
  });
});

describe("markdownMathKind", () => {
  it("reads remark-math classes and ignores other code", () => {
    expect(markdownMathKind("language-math math-inline")).toBe("inline");
    expect(markdownMathKind("language-math math-display")).toBe("display");
    expect(markdownMathKind("language-ts")).toBeNull();
    expect(markdownMathKind(undefined)).toBeNull();
  });
});
