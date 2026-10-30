import type { IconNode, MorphIconProps } from "morphicons/react";
import { createElement, lazy, Suspense } from "react";

// The morphing runtime loads after first paint; until then the same shape draws statically.
const LazyMorphIcon = lazy(() =>
  import("morphicons/react").then((module) => ({ default: module.MorphIcon })),
);

/**
 * Renders `lucide` icon data and morphs between shapes when `icon` changes. Its svg is not a
 * `.lucide` element, so it takes the app's lighter icon stroke here.
 */
export function MorphIcon({
  reducedMotion = "user",
  strokeWidth = 1.75,
  ...props
}: MorphIconProps) {
  return (
    <Suspense fallback={<StaticIcon {...props} strokeWidth={strokeWidth} />}>
      <LazyMorphIcon reducedMotion={reducedMotion} strokeWidth={strokeWidth} {...props} />
    </Suspense>
  );
}

function StaticIcon({
  icon,
  size = 24,
  color = "currentColor",
  strokeWidth,
  className,
}: Pick<MorphIconProps, "icon" | "size" | "color" | "strokeWidth" | "className">) {
  return (
    <svg
      aria-hidden
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {Array.isArray(icon)
        ? (icon as IconNode).map(([tag, attrs], index) =>
            createElement(tag, { key: index, ...attrs }),
          )
        : null}
    </svg>
  );
}
