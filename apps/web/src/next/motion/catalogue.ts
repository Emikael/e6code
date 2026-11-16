import type { MotionRecipe } from "./presets/recipes.ts";

/**
 * Every preset and catalogue moment (design direction 3.9 and 5.4), for the style guide's
 * motion gallery (E01-T16) to render with replay at each level. `use` names the export a
 * screen takes; `credit` names the idea it was written from (see design-sourcing.md).
 */
export interface CatalogueEntry {
  readonly name: string;
  readonly engine: "none" | "css" | "presence" | "layout" | "oneShot";
  readonly use:
    | MotionRecipe
    | "PresenceSwap"
    | "NumberRoll"
    | "LayoutBox"
    | "oneShots.shake"
    | null;
  readonly credit?: string;
}

export const MOTION_CATALOGUE: ReadonlyArray<CatalogueEntry> = [
  { name: "cut", engine: "none", use: null },
  { name: "fade", engine: "css", use: "fade" },
  { name: "reveal", engine: "css", use: "reveal" },
  { name: "swap", engine: "presence", use: "PresenceSwap" },
  {
    name: "iconSwap",
    engine: "presence",
    use: "PresenceSwap",
    credit: "transitions.dev Icon swap",
  },
  {
    name: "numberChange",
    engine: "presence",
    use: "NumberRoll",
    credit: "transitions.dev Number subtle change; React Bits Count Up",
  },
  {
    name: "checkDraw",
    engine: "css",
    use: "checkDraw",
    credit: "transitions.dev Success check, Checkbox check",
  },
  { name: "press", engine: "css", use: "press" },
  { name: "pop", engine: "css", use: "pop", credit: "transitions.dev Menu dropdown" },
  { name: "dolly", engine: "css", use: "dolly", credit: "transitions.dev Panel reveal" },
  { name: "matchCut", engine: "layout", use: "LayoutBox" },
  { name: "layout", engine: "layout", use: "LayoutBox" },
  {
    name: "sideBySide",
    engine: "css",
    use: "sideBySide",
    credit: "transitions.dev Page side-by-side",
  },
  { name: "sweep", engine: "css", use: "sweep" },
  {
    name: "shake",
    engine: "oneShot",
    use: "oneShots.shake",
    credit: "transitions.dev Error state shake",
  },
  // Catalogue moments.
  { name: "toast", engine: "css", use: "toast", credit: "transitions.dev Toast open/close" },
  { name: "tooltip", engine: "css", use: "tooltip", credit: "transitions.dev Tooltip" },
  { name: "contextMenu", engine: "css", use: "contextMenu" },
  { name: "dialog", engine: "css", use: "dialog", credit: "transitions.dev Modal open/close" },
  { name: "dialogScrim", engine: "css", use: "dialogScrim" },
  {
    name: "tabIndicator",
    engine: "css",
    use: "tabIndicator",
    credit: "transitions.dev Tabs sliding",
  },
  { name: "copyConfirm", engine: "presence", use: "PresenceSwap" },
  {
    name: "streamTail",
    engine: "css",
    use: "streamTail",
    credit: "transitions.dev Streaming text",
  },
  {
    name: "reasoningEdge",
    engine: "css",
    use: "reasoningEdge",
    credit: "transitions.dev Reasoning stream",
  },
  {
    name: "skeleton",
    engine: "css",
    use: "skeleton",
    credit: "transitions.dev Skeleton loader and reveal",
  },
];
