type Rgb = readonly [number, number, number];
type Color = { rgb: Rgb; alpha: number };

// A measurable visual hierarchy in addition to each ink's AA contrast against its surface.
const MIN_MUTED_DISTINCTION = 1.6;

const MUTED_DISTINCTION_EXCEPTIONS = [
  { theme: "e6-chat", appearance: "light", surface: "sidebar", minimum: 1.33 },
] as const;

export function mutedDistinctionMinimum(theme: string, appearance: string, surface: string) {
  return (
    MUTED_DISTINCTION_EXCEPTIONS.find(
      (exception) =>
        exception.theme === theme &&
        exception.appearance === appearance &&
        exception.surface === surface,
    )?.minimum ?? MIN_MUTED_DISTINCTION
  );
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const luminance = (color: Rgb) => {
    const linear = color.map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  };
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function composite(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  return [
    foreground[0] * alpha + background[0] * (1 - alpha),
    foreground[1] * alpha + background[1] * (1 - alpha),
    foreground[2] * alpha + background[2] * (1 - alpha),
  ];
}

function over(foreground: Color, background: Color): Color {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  return {
    rgb:
      alpha === 0 ? [0, 0, 0] : composite(foreground.rgb, background.rgb, foreground.alpha / alpha),
    alpha,
  };
}

/** CSS opacity flattens a whole group, including its background, before its parent paints it. */
export function renderTextColors(
  foreground: Color,
  layers: ReadonlyArray<{ color: Color; opacity: number }>,
) {
  let ink = foreground;
  let surface: Color = { rgb: [0, 0, 0], alpha: 0 };
  for (const layer of layers) {
    ink = over(ink, layer.color);
    surface = over(surface, layer.color);
    ink.alpha *= layer.opacity;
    surface.alpha *= layer.opacity;
  }
  const canvas: Rgb = [255, 255, 255];
  return {
    foreground: composite(ink.rgb, canvas, ink.alpha),
    background: composite(surface.rgb, canvas, surface.alpha),
  };
}

/** Read actual browser-resolved colors, including status tints and ancestor surfaces. */
export function auditPrimitiveText(scope?: { theme?: string; appearance?: string }) {
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas color resolution unavailable");
  const colors = new Map<string, Color>();
  const resolve = (color: string) => {
    const cached = colors.get(color);
    if (cached) return cached;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    const resolved = { rgb: [r!, g!, b!] as Rgb, alpha: a! / 255 };
    colors.set(color, resolved);
    return resolved;
  };
  const layersFor = (element: Element) => {
    const layers = [];
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      layers.push({
        color: resolve(style.backgroundColor),
        opacity: Number(style.opacity),
      });
    }
    return layers;
  };
  const failures: {
    category: "contrast" | "muted-distinction";
    text: string;
    ratio: number;
    foreground: string;
    background: Rgb;
    minimum: number;
  }[] = [];
  const mutedChecks: { surface: string; ratio: number; minimum: number }[] = [];
  let checked = 0;
  const check = (element: Element, text: string) => {
    const control = element.closest(
      "button,input,select,textarea,option,a[href],[role=button],[role=menuitem],[role=link]",
    );
    if (control?.matches(':disabled,[aria-disabled="true"]')) return;
    const style = getComputedStyle(element);
    if (style.visibility !== "visible") return;
    const layers = layersFor(element);
    if (layers.some((layer) => layer.opacity === 0)) return;
    const { foreground, background } = renderTextColors(resolve(style.color), layers);
    const ratio = contrastRatio(foreground, background);
    checked++;
    if (ratio < 4.5) {
      failures.push({
        category: "contrast",
        text,
        ratio,
        foreground: style.color,
        background,
        minimum: 4.5,
      });
    }
  };
  for (const surface of document.querySelectorAll("[data-contrast-fixture]")) {
    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent?.trim();
      const element = node.parentElement;
      if (!text || !element) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.width > 1 && rect.height > 1) check(element, text);
    }
    // Native field values have no text nodes.
    for (const field of surface.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("input:not([type=checkbox]):not([type=radio]), select, textarea")) {
      const rect = field.getBoundingClientRect();
      if (field.value && rect.width > 1 && rect.height > 1) check(field, field.value);
    }
    const probe = document.createElement("span");
    probe.style.color = "var(--sb-muted)";
    surface.append(probe);
    try {
      const normal = renderTextColors(resolve(getComputedStyle(surface).color), layersFor(surface));
      const mutedColor = getComputedStyle(probe).color;
      const muted = renderTextColors(resolve(mutedColor), layersFor(probe));
      const ratio = contrastRatio(normal.foreground, muted.foreground);
      const name = surface.getAttribute("data-switchboard") ?? "fixture";
      const minimum = mutedDistinctionMinimum(scope?.theme ?? "", scope?.appearance ?? "", name);
      mutedChecks.push({ surface: name, ratio, minimum });
      if (ratio < minimum) {
        failures.push({
          category: "muted-distinction",
          text: `${name}: muted and normal text`,
          ratio,
          foreground: mutedColor,
          background: normal.foreground,
          minimum,
        });
      }
    } finally {
      probe.remove();
    }
  }
  if (!checked) throw new Error("No visible primitive text checked");
  return { checked, failures, mutedChecks };
}
