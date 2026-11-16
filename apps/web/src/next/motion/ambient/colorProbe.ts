/**
 * Resolves the ambient colour roles to floats for the shader. Computed colours arrive as
 * `oklab()`, `color()` or `rgb()` depending on how the role was mixed, so a hidden probe
 * resolves the role and a 1×1 2D canvas normalises it to RGBA.
 */
import type { AmbientColors } from "@e6tools/shared/ambientLight";

let scratch: CanvasRenderingContext2D | null | undefined;

const toRgba = (color: string): [number, number, number, number] => {
  scratch ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!scratch) return [0, 0, 0, 0];
  scratch.clearRect(0, 0, 1, 1);
  scratch.fillStyle = "transparent";
  scratch.fillStyle = color;
  scratch.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 0] = scratch.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255, a / 255];
};

/** `--ray-tint` as a 0 to 1 amount; anything unreadable means no tint. */
export const parseTintAmount = (value: string): number => {
  const amount = Number.parseFloat(value);
  return Number.isFinite(amount) ? Math.min(Math.max(amount, 0), 1) : 0;
};

/** Reads `--light-ray`, `--primary` and `--ray-tint` as they apply inside `scope`. */
export const readAmbientColors = (scope: Element): AmbientColors => {
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  scope.append(probe);
  try {
    probe.style.color = "var(--light-ray)";
    const ray = toRgba(getComputedStyle(probe).color);
    probe.style.color = "var(--primary)";
    const [r, g, b] = toRgba(getComputedStyle(probe).color);
    return {
      ray,
      tint: [r, g, b],
      tintAmount: parseTintAmount(getComputedStyle(scope).getPropertyValue("--ray-tint")),
    };
  } finally {
    probe.remove();
  }
};

/**
 * Calls `onChange` when the theme, accent or colour scheme may have changed: `useTheme`
 * writes `class`, `style` and `data-theme-id` on `<html>`. Returns the unsubscribe function.
 */
export const watchThemeChanges = (onChange: () => void): (() => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme-id"],
  });
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    scheme.removeEventListener("change", onChange);
  };
};
