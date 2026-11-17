import type { PLANE_RECIPES } from "@e6tools/design-tokens/keyLight";
import type { ComponentProps } from "react";

import "./planes.css";

type PlaneProps = ComponentProps<"div"> &
  (
    | { readonly level: keyof typeof PLANE_RECIPES; readonly material?: never }
    | {
        readonly level: "float" | "overlay";
        /**
         * The floating material: a static blur over a translucent plane. Only for a plane
         * smaller than a quarter of the viewport (menus, popovers, the palette panel, toasts,
         * the desktop title-bar strip); never a full-height panel. It is opaque under Reduced,
         * without `backdrop-filter` and on touch-first web.
         */
        readonly material?: boolean;
      }
  ) & {
    /** `false` fades the shadow out; `box-shadow` itself never animates. Default shown. */
    readonly shadow?: boolean;
  };

/**
 * A Key Light plane: fill, edge and elevation for its level. An `overlay` sits over a `Scrim`.
 * Radius comes from `className` (`rounded-card`, `rounded-overlay`, ...). Position does not: a
 * plane is always `relative`, so place it through a positioned wrapper (see `planes.css`).
 */
export function Plane({ level, material, shadow = true, className, ...props }: PlaneProps) {
  return (
    <div
      {...props}
      className={className ? `plane ${className}` : "plane"}
      data-plane={level}
      data-material={material ? "float" : undefined}
      data-shadow={shadow ? undefined : "hidden"}
    />
  );
}

/**
 * The dim behind an overlay. It fills its positioned parent, or the viewport with `viewport`
 * (a `fixed` class does not move it; see `planes.css`). The stage behind is never blurred or
 * scaled.
 */
export function Scrim({
  viewport,
  className,
  ...props
}: ComponentProps<"div"> & { readonly viewport?: boolean }) {
  return (
    <div
      aria-hidden="true"
      {...props}
      className={className ? `scrim ${className}` : "scrim"}
      data-viewport={viewport ? "" : undefined}
    />
  );
}
