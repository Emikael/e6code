/**
 * Class names of the CSS presets in `presets.css`, which `MotionRoot` loads. Presence presets
 * put `motion-enter` beside the preset class; Base UI wrappers (E01-T14) add them to the
 * popup, and Base UI's `data-starting-style` / `data-ending-style` drive the transition.
 *
 * Attributes the recipes read:
 * - `dolly`: `data-edge="start"` when the panel docks on the leading edge.
 * - `sideBySide`: `data-direction="back"` going up a level (see `depthDirection`).
 * - `press`: `data-pressed` while a key holds it down.
 * - `checkDraw`: `data-size="checkbox"`, and `data-unchecked` to reset; the path has
 *   `pathLength="1"`.
 * - `tabIndicator`: `--tab-x` and `--tab-scale`, measured once per change.
 */
export const MOTION_RECIPES = {
  fade: "motion-enter motion-fade",
  reveal: "motion-enter motion-reveal",
  toast: "motion-enter motion-toast",
  pop: "motion-enter motion-pop",
  tooltip: "motion-enter motion-tooltip",
  /** Right-click menus fade like tooltips (design direction 3.10). */
  contextMenu: "motion-enter motion-tooltip",
  dialogScrim: "motion-enter motion-dialog-scrim",
  dialog: "motion-enter motion-dialog",
  dolly: "motion-enter motion-dolly",
  sideBySide: "motion-enter motion-side-by-side",
  streamTail: "motion-enter motion-stream-flush",
  press: "motion-press",
  checkDraw: "motion-check-draw",
  tabIndicator: "motion-tab-indicator",
  sweep: "motion-sweep",
  skeleton: "motion-skeleton",
  reasoningEdge: "motion-reasoning-edge",
} as const;

export type MotionRecipe = keyof typeof MOTION_RECIPES;
