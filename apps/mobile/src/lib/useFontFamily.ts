// Native family names registered by the expo-font plugin in app.config.ts.
const FONT_FAMILIES = {
  regular: "Geist-Regular",
  medium: "Geist-Medium",
  bold: "Geist-Bold",
} as const;

/** Geist Mono for code surfaces; pair with fontWeight for bold runs. */
export const MONO_FONT_FAMILY = "GeistMono-Regular";

/** Geist for native renderers that pick weights from the `<family>-<Weight>` faces. */
export const SANS_FONT_FAMILY = FONT_FAMILIES.regular;

/**
 * Resolves a font family for APIs that require a style object or native prop.
 * Prefer Uniwind font classes when the target component accepts `className`.
 */
export function useFontFamily(weight: keyof typeof FONT_FAMILIES): string {
  return FONT_FAMILIES[weight];
}
