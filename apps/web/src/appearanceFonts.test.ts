import { describe, expect, it } from "vite-plus/test";

import {
  type AppearanceFontPreferences,
  applyAppearanceFontVariables,
  areFontAdvancesMonospace,
  clampCodeFontSize,
  clampInterfaceFontSize,
  clampPromptFontSize,
  cssFontFamilies,
  resolveDefaultFamilyLabel,
  resolveTerminalFontPreference,
  resolveTerminalFontSizePreference,
} from "./appearanceFonts";

describe("areFontAdvancesMonospace", () => {
  it("accepts a fixed advance and rejects any proportional glyph", () => {
    expect(areFontAdvancesMonospace([10, 10, 10, 10])).toBe(true);
    expect(areFontAdvancesMonospace([10, 10, 7, 10])).toBe(false);
    expect(areFontAdvancesMonospace([10, 10.02])).toBe(false);
  });

  it("fails open when canvas metrics are unavailable", () => {
    expect(areFontAdvancesMonospace([])).toBe(true);
    expect(areFontAdvancesMonospace([Number.NaN, Number.NaN])).toBe(true);
  });
});

describe("cssFontFamilies", () => {
  it("returns null for effectively empty input", () => {
    expect(cssFontFamilies("")).toBeNull();
    expect(cssFontFamilies("   ")).toBeNull();
    expect(cssFontFamilies(" , , ")).toBeNull();
  });

  it("quotes names with spaces and keeps single idents bare", () => {
    expect(cssFontFamilies("Fira Code")).toBe('"Fira Code"');
    expect(cssFontFamilies("monospace")).toBe("monospace");
    expect(cssFontFamilies('"Comic Mono"')).toBe('"Comic Mono"');
  });

  it("normalizes comma-separated lists and strips embedded quotes", () => {
    expect(cssFontFamilies(" Fira Code , Menlo ")).toBe('"Fira Code", Menlo');
    expect(cssFontFamilies('Bad"Name')).toBe('"BadName"');
  });

  it("quotes names that are not single CSS idents", () => {
    expect(cssFontFamilies("3270 Nerd Font")).toBe('"3270 Nerd Font"');
    expect(cssFontFamilies("M+ 1m")).toBe('"M+ 1m"');
  });
});

describe("resolveDefaultFamilyLabel", () => {
  it("skips generic keywords and returns null for a stack of only generics", () => {
    expect(resolveDefaultFamilyLabel("system-ui, sans-serif")).toBeNull();
    expect(resolveDefaultFamilyLabel("ui-monospace, monospace")).toBeNull();
  });
});

describe("resolveTerminalFontPreference", () => {
  it("inherits the code font in simple mode", () => {
    expect(
      resolveTerminalFontPreference({ advanced: false, code: "Fira Code", terminal: "" }),
    ).toBe("Fira Code");
    expect(
      resolveTerminalFontPreference({
        advanced: false,
        code: "Fira Code",
        terminal: "Berkeley Mono",
      }),
    ).toBe("Fira Code");
  });

  it("keeps code and terminal fonts independent in advanced mode", () => {
    expect(resolveTerminalFontPreference({ advanced: true, code: "Fira Code", terminal: "" })).toBe(
      "",
    );
    expect(
      resolveTerminalFontPreference({
        advanced: true,
        code: "Fira Code",
        terminal: "Berkeley Mono",
      }),
    ).toBe("Berkeley Mono");
  });
});

describe("resolveTerminalFontSizePreference", () => {
  it("inherits the code font size in simple mode", () => {
    expect(resolveTerminalFontSizePreference({ advanced: false, code: 15, terminal: 12 })).toBe(15);
  });

  it("keeps code and terminal font sizes independent in advanced mode", () => {
    expect(resolveTerminalFontSizePreference({ advanced: true, code: 15, terminal: 12 })).toBe(12);
  });
});

describe("font size clamping", () => {
  it("keeps sizes inside the ranges the UI can absorb", () => {
    expect(clampInterfaceFontSize(16)).toBe(16);
    expect(clampInterfaceFontSize(2)).toBe(12);
    expect(clampInterfaceFontSize(96)).toBe(20);
    expect(clampPromptFontSize(40)).toBe(20);
    expect(clampCodeFontSize(1)).toBe(10);
  });

  it("rounds fractional values and falls back for unusable input", () => {
    expect(clampCodeFontSize(13.4)).toBe(13);
    expect(clampInterfaceFontSize(Number.NaN)).toBe(16);
    expect(clampPromptFontSize(Number.POSITIVE_INFINITY)).toBe(14);
  });
});

describe("applyAppearanceFontVariables", () => {
  function applied(overrides: Partial<AppearanceFontPreferences>) {
    const properties = new Map<string, string>();
    const style = {
      fontSize: "",
      setProperty: (name: string, value: string) => void properties.set(name, value),
      removeProperty: (name: string) => void properties.delete(name),
    };
    applyAppearanceFontVariables({ style } as unknown as HTMLElement, {
      sans: "",
      code: "",
      composer: "",
      sizeInterface: 16,
      sizePrompt: 14,
      sizeCode: 13,
      smoothing: true,
      chatTextSize: null,
      ...overrides,
    });
    return { properties, fontSize: style.fontSize };
  }

  it("keeps today's chat size for an install without a chat size (14 px at 16, 1.625)", () => {
    const { properties } = applied({ chatTextSize: null });
    expect(properties.get("--prose-size")).toBe("0.875rem");
    expect(properties.get("--prose-leading")).toBe("1.625");
  });

  it("sets chat text in px on a 24 px line at the D10 default", () => {
    const { properties } = applied({ chatTextSize: 15 });
    expect(properties.get("--prose-size")).toBe("15px");
    expect(properties.get("--prose-leading")).toBe("1.6");
  });

  it("drops strong weights to 600 only while an interface font override is set", () => {
    expect(applied({ sans: "Inter" }).properties.get("--weight-strong")).toBe("600");
    expect(applied({ sans: "" }).properties.has("--weight-strong")).toBe(false);
  });
});
