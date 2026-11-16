import { describe, expect, it } from "vite-plus/test";

import { DUR_S } from "../tokens.ts";
import { layoutTransition, presenceForms } from "./presets.ts";

const COMPOSITOR_KEYS = new Set(["opacity", "x", "y", "scale", "transition"]);
const REDUCED_CAP_S = 0.15;

describe("presence presets", () => {
  const forms = presenceForms();

  it("animate only transform and opacity", () => {
    for (const { form } of forms) {
      if (form === null) continue;
      for (const values of [form.initial, form.animate, form.exit]) {
        for (const key of Object.keys(values)) expect(COMPOSITOR_KEYS).toContain(key);
      }
    }
  });

  it("are cuts at Off", () => {
    expect(forms.filter(({ level }) => level === "off").map(({ form }) => form)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("fade without travel or scale at Reduced, within 150 ms", () => {
    for (const { level, form } of forms) {
      if (level !== "reduced" || form === null) continue;
      for (const values of [form.initial, form.animate, form.exit]) {
        expect(values).not.toHaveProperty("x");
        expect(values).not.toHaveProperty("y");
        expect(values).not.toHaveProperty("scale");
      }
      expect(form.animate.transition.duration).toBeLessThanOrEqual(REDUCED_CAP_S);
      expect(form.exit.transition.duration).toBeLessThanOrEqual(REDUCED_CAP_S);
    }
  });

  it("never exit slower than they enter", () => {
    for (const { form } of forms) {
      if (form === null) continue;
      expect(form.exit.transition.duration).toBeLessThanOrEqual(form.animate.transition.duration);
    }
  });

  it("end where they started: at rest, fully opaque", () => {
    for (const { form } of forms) {
      if (form === null) continue;
      expect(form.animate.opacity).toBe(1);
      expect(form.animate.x ?? 0).toBe(0);
      expect(form.animate.y ?? 0).toBe(0);
      expect(form.animate.scale ?? 1).toBe(1);
    }
  });

  it("swap enters on the brisk step", () => {
    const swap = forms.find(({ preset, level }) => preset === "swap" && level === "full");
    expect(swap?.form?.animate.transition.duration).toBe(DUR_S.brisk);
  });
});

describe("layout presets", () => {
  it("move only at Full", () => {
    for (const preset of ["layout", "matchCut"] as const) {
      expect(layoutTransition(preset, "full")).not.toBeNull();
      expect(layoutTransition(preset, "reduced")).toBeNull();
      expect(layoutTransition(preset, "off")).toBeNull();
    }
  });
});
