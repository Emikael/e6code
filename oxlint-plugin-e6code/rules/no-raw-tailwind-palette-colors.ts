import { defineRule } from "@oxlint/plugins";

// Tailwind's default palette, including the v4.2 neutrals.
const PALETTE =
  "slate|gray|zinc|neutral|stone|mauve|olive|mist|taupe|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const COLOR_UTILITY =
  "bg|text|border(?:-[xytrbles])?|ring(?:-offset)?|inset-ring|outline|fill|stroke|from|via|to|divide|placeholder|caret|accent|decoration|shadow|inset-shadow|drop-shadow|text-shadow";
// A utility such as `bg-blue-500`, `hover:text-zinc-400/50` or `text-white`, anywhere in a string.
const RAW_PALETTE_CLASS = new RegExp(
  `(?<![\\w-])(?:${COLOR_UTILITY})-(?:(?:${PALETTE})-(?:50|[1-9]00|950)|black|white)(?:/[\\w.%\\[\\]]+)?(?![\\w-])`,
  "u",
);
const MESSAGE =
  "Raw Tailwind palette colours do not follow themes; use a semantic role (bg-primary, text-muted-foreground, …).";

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep colour on the semantic roles. Scope the rule to redesigned (v2) sources in the lint config.",
    },
    schema: [],
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== "string" || !RAW_PALETTE_CLASS.test(node.value)) return;
        context.report({ node, message: MESSAGE });
      },
      TemplateElement(node) {
        if (!RAW_PALETTE_CLASS.test(node.value.cooked ?? "")) return;
        context.report({ node, message: MESSAGE });
      },
    };
  },
});
