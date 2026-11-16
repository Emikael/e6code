import { ChatWidth } from "@e6tools/contracts/settings";
import { describe, expect, it } from "vite-plus/test";

import { BREAKPOINTS, GAP_PANEL, HEIGHTS, LAYOUT, MEASURE_CHAT, SPACE } from "./layout.ts";
import type { CssNode, CssRule } from "./webStock.ts";

const REM = 16;
const px = (rem: string) => Number(rem.replace(/rem$/, "")) * REM;

function declarationsAt(header: string): Record<string, string> {
  const rule = LAYOUT.find((each) => each.rule === header);
  if (!rule) throw new Error(`No rule ${header}`);
  return Object.fromEntries(
    rule.body.filter((node: CssNode) => Array.isArray(node)) as [string, string][],
  );
}

function nested(header: string, inner: string): Record<string, string> {
  const rule = LAYOUT.find((each) => each.rule === header)!;
  const child = rule.body.find((node): node is CssRule => "rule" in node && node.rule === inner);
  if (!child) throw new Error(`No rule ${header} > ${inner}`);
  return Object.fromEntries(child.body as [string, string][]);
}

// Direction C "Lit Stage" (ENG-141) and the maintainer's answers on ENG-129. A change here
// is a design change.
describe("layout values", () => {
  it("keeps whole space steps on the 4 px grid and half steps on 2 px", () => {
    for (const steps of SPACE) {
      expect((steps * 4) % (Number.isInteger(steps) ? 4 : 2), String(steps)).toBe(0);
    }
    expect(SPACE).toEqual([0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16]);
  });

  it("sizes rows and controls as direction C, in rem", () => {
    expect(HEIGHTS).toEqual({
      "row-dense": "1.75rem",
      row: "2rem",
      "row-two-line": "3rem",
      control: "2rem",
      "control-lg": "2.5rem",
      touch: "max(2.75rem, 44px)",
    });
    expect(px(HEIGHTS["row-two-line"])).toBe(px(HEIGHTS.row) * 1.5);
  });

  it("widens Standard to 720 px and keeps Wide and Full as today", () => {
    expect(MEASURE_CHAT).toEqual({ comfortable: "45rem", wide: "72rem", full: "100%" });
    expect(Object.keys(MEASURE_CHAT).toSorted()).toEqual([...ChatWidth.literals].toSorted());
  });

  it("opens a 10 px panel gap on desktop widths and none on mobile web", () => {
    expect(GAP_PANEL).toEqual({ mobileWeb: "0px", desktop: "0.625rem" });
  });

  it("records today's breakpoints", () => {
    expect(BREAKPOINTS).toEqual({
      mobileWeb: 360,
      compact: 640,
      sheet: 768,
      rightPanelSheet: 980,
      max: 2560,
    });
  });
});

describe("layout block", () => {
  it("declares spacing, heights, the measure and the gap on :root", () => {
    expect(declarationsAt(":root")).toEqual({
      "--space-0_5": "calc(var(--spacing) * 0.5)",
      "--space-1": "calc(var(--spacing) * 1)",
      "--space-1_5": "calc(var(--spacing) * 1.5)",
      "--space-2": "calc(var(--spacing) * 2)",
      "--space-3": "calc(var(--spacing) * 3)",
      "--space-4": "calc(var(--spacing) * 4)",
      "--space-5": "calc(var(--spacing) * 5)",
      "--space-6": "calc(var(--spacing) * 6)",
      "--space-8": "calc(var(--spacing) * 8)",
      "--space-10": "calc(var(--spacing) * 10)",
      "--space-12": "calc(var(--spacing) * 12)",
      "--space-16": "calc(var(--spacing) * 16)",
      "--row-dense": "1.75rem",
      "--row": "2rem",
      "--row-two-line": "3rem",
      "--control": "2rem",
      "--control-lg": "2.5rem",
      "--touch": "max(2.75rem, 44px)",
      "--measure-chat": "45rem",
      "--gap-panel": "0px",
    });
    expect(nested(":root", "@variant md")).toEqual({ "--gap-panel": "0.625rem" });
  });

  it("follows the Chat width setting through data-chat-width", () => {
    expect(declarationsAt(':root[data-chat-width="wide"]')).toEqual({ "--measure-chat": "72rem" });
    expect(declarationsAt(':root[data-chat-width="full"]')).toEqual({ "--measure-chat": "100%" });
  });

  it("maps heights and the measure into Tailwind utilities", () => {
    expect(declarationsAt("@theme inline")).toEqual({
      "--spacing-row-dense": "var(--row-dense)",
      "--spacing-row": "var(--row)",
      "--spacing-row-two-line": "var(--row-two-line)",
      "--spacing-control": "var(--control)",
      "--spacing-control-lg": "var(--control-lg)",
      "--spacing-touch": "var(--touch)",
      "--container-chat": "var(--measure-chat)",
    });
  });
});
