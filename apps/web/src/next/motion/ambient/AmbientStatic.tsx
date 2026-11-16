import type { Ref } from "react";

import "./ambient.css";

/**
 * The ambient light's static gradient alone: zero-projects, and every fallback. Fills its
 * positioned parent and sits under the surface's content. Decorative, so hidden from
 * assistive technology.
 */
export function AmbientStatic({
  className,
  ref,
  raysRef,
  "data-ambient": readout,
}: {
  readonly className?: string;
  readonly ref?: Ref<HTMLDivElement>;
  readonly raysRef?: Ref<HTMLDivElement>;
  /** The state readout, for debugging and the harness; never announced. */
  readonly "data-ambient"?: string;
}) {
  return (
    <div
      ref={ref}
      className={className ? `ambient-light ${className}` : "ambient-light"}
      aria-hidden="true"
      data-ambient={readout}
    >
      <div className="ambient-light__wash" />
      <div ref={raysRef} className="ambient-light__rays" />
    </div>
  );
}
