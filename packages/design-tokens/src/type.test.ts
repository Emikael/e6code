import { describe, expect, it } from "vite-plus/test";

import { MOBILE_TYPE_SCALE, TYPE_BLOCKS } from "./type.ts";

const declarations = (): Record<string, string> =>
  Object.fromEntries(
    TYPE_BLOCKS.type.body.filter((node): node is readonly [string, string] => Array.isArray(node)),
  );

describe("type block", () => {
  it("emits each step as a Tailwind text utility with its line height, weight and tracking", () => {
    expect(declarations()).toMatchObject({
      "--text-micro": "0.6875rem",
      "--text-micro--line-height": "0.875rem",
      "--text-micro--font-weight": "500",
      "--text-micro--letter-spacing": "0.01em",
      "--text-label": "0.75rem",
      "--text-heading": "1.1875rem",
      "--text-heading--font-weight": "var(--weight-strong, 650)",
      "--text-heading--letter-spacing": "-0.02em",
      "--text-display-s": "1.625rem",
      "--text-display": "2.25rem",
    });
  });

  it("reads chat text from the chat size hook, defaulting to 15 / 24", () => {
    expect(declarations()).toMatchObject({
      "--text-prose": "var(--prose-size, 0.9375rem)",
      "--text-prose--line-height": "var(--prose-leading, 1.5rem)",
    });
  });

  it("keeps every size in rem and none below 11 px", () => {
    const sizes = Object.entries(declarations()).filter(([name]) => !name.slice(2).includes("--"));
    expect(sizes.length).toBe(9);
    for (const [name, value] of sizes) {
      const rem = value.match(/(\d*\.?\d+)rem\)?$/);
      expect(rem, name).not.toBeNull();
      expect(Number(rem![1]) * 16, name).toBeGreaterThanOrEqual(11);
    }
  });

  it("leaves the marketing-only display-l step out of the app", () => {
    expect(Object.keys(declarations()).filter((name) => name.includes("display-l"))).toEqual([]);
  });
});

describe("mobile type scale", () => {
  it("mirrors the web scale in px, with weights the embedded Geist faces carry", () => {
    expect(MOBILE_TYPE_SCALE.prose).toEqual({
      fontSize: 15,
      lineHeight: 24,
      fontWeight: "400",
      letterSpacing: 0,
    });
    // 650 has no static face on mobile; 600 is what a face without a weight axis gets on web.
    expect(MOBILE_TYPE_SCALE.heading).toEqual({
      fontSize: 19,
      lineHeight: 24,
      fontWeight: "600",
      letterSpacing: -0.38,
    });
    expect(MOBILE_TYPE_SCALE.micro).toEqual({
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "500",
      letterSpacing: 0.11,
    });
    expect(Object.keys(MOBILE_TYPE_SCALE)).not.toContain("displayL");
  });
});
