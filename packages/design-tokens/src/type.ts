import { TYPE_SCALE } from "./keyLight.ts";
import type { CssNode, CssRule } from "./webStock.ts";

type Step = keyof typeof TYPE_SCALE;

/** Marketing only (48 to 72 px); the app neither emits nor mirrors it. */
const APP_STEPS = (Object.keys(TYPE_SCALE) as Step[]).filter((step) => step !== "displayL");

const cssName = (step: Step) => `--text-${step.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/**
 * Chat text reads the hook `appearanceFonts.ts` writes from the chat size setting, so
 * `text-prose` follows it; the scale's 15 / 24 applies only before the hook is written.
 */
const PROSE_HOOK = { size: "--prose-size", lineHeight: "--prose-leading" } as const;

function stepDeclarations(step: Step): CssNode[] {
  const { size, lineHeight, weight, tracking } = TYPE_SCALE[step];
  const name = cssName(step);
  const hooked = step === "prose";
  return [
    [name, hooked ? `var(${PROSE_HOOK.size}, ${size})` : size],
    [`${name}--line-height`, hooked ? `var(${PROSE_HOOK.lineHeight}, ${lineHeight})` : lineHeight],
    [`${name}--font-weight`, weight],
    [`${name}--letter-spacing`, tracking],
  ];
}

/**
 * The `type` block of `index.css`: one Tailwind text utility per step (`text-label`,
 * `text-prose`, ...) carrying its size, line height, weight and tracking. Sizes are `rem`,
 * so the Interface font size setting scales them like legacy text.
 */
export const TYPE_BLOCKS = {
  type: { rule: "@theme", body: APP_STEPS.flatMap(stepDeclarations) },
} as const satisfies Record<string, CssRule>;

const REM_PX = 16;
const px = (rem: string) => Number.parseFloat(rem) * REM_PX;

/**
 * The scale for React Native style props, in px. Mobile embeds static Geist faces (400, 500,
 * 600, 700), so 650 maps to 600, the weight web uses when a face has no weight axis.
 * Tracking becomes px because React Native's `letterSpacing` takes no `em`.
 */
export const MOBILE_TYPE_SCALE = Object.fromEntries(
  APP_STEPS.map((step) => {
    const { size, lineHeight, weight, tracking } = TYPE_SCALE[step];
    const fontSize = px(size);
    const fontWeight = weight === "400" || weight === "500" ? weight : "600";
    const letterSpacing = Math.round(Number.parseFloat(tracking) * fontSize * 100) / 100;
    return [step, { fontSize, lineHeight: px(lineHeight), fontWeight, letterSpacing }];
  }),
) as Record<
  Exclude<Step, "displayL">,
  {
    readonly fontSize: number;
    readonly lineHeight: number;
    readonly fontWeight: "400" | "500" | "600";
    readonly letterSpacing: number;
  }
>;
