import { describe, expect, it } from "vite-plus/test";
import { composite, contrastRatio, renderTextColors } from "./contrast";

describe("fixture WCAG contrast audit", () => {
  it("uses WCAG relative luminance and composites translucent surfaces", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBe(21);
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBe(1);
    expect(contrastRatio([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 2);
    expect(composite([0, 0, 0], [200, 200, 200], 0.1)).toEqual([180, 180, 180]);
  });

  it("composites the whole ancestor group before measuring active text", () => {
    const rendered = renderTextColors({ rgb: [0, 0, 0], alpha: 1 }, [
      { color: { rgb: [255, 255, 255], alpha: 1 }, opacity: 0.5 },
      { color: { rgb: [0, 0, 0], alpha: 1 }, opacity: 1 },
    ]);
    expect(rendered.foreground).toEqual([0, 0, 0]);
    expect(rendered.background).toEqual([127.5, 127.5, 127.5]);
    expect(contrastRatio(rendered.foreground, rendered.background)).toBeGreaterThan(5);
  });

  it("keeps nested opacity and foreground alpha in the measured result", () => {
    const rendered = renderTextColors({ rgb: [255, 255, 255], alpha: 0.5 }, [
      { color: { rgb: [0, 0, 0], alpha: 1 }, opacity: 0.5 },
      { color: { rgb: [255, 255, 255], alpha: 1 }, opacity: 0.5 },
      { color: { rgb: [0, 0, 0], alpha: 1 }, opacity: 1 },
    ]);
    expect(rendered.foreground).toEqual([95.625, 95.625, 95.625]);
    expect(rendered.background).toEqual([63.75, 63.75, 63.75]);
    expect(contrastRatio(rendered.foreground, rendered.background)).toBeLessThan(4.5);
  });
});
