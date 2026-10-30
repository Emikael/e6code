import { MorphIcon as BaseMorphIcon, type MorphIconProps } from "morphicons/react";

/**
 * Renders `lucide` icon data and morphs between shapes when `icon` changes. Its svg is not a
 * `.lucide` element, so it takes the app's lighter icon stroke here.
 */
export function MorphIcon({
  reducedMotion = "user",
  strokeWidth = 1.75,
  ...props
}: MorphIconProps) {
  return <BaseMorphIcon reducedMotion={reducedMotion} strokeWidth={strokeWidth} {...props} />;
}
