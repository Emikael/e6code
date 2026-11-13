import type { SVGProps } from "react";

import { E6_GLYPH_PATHS, E6_GLYPH_VIEW_BOX } from "@e6tools/shared/brandMark";

/** The E6 glyph alone, in `currentColor`, cropped to its box. */
export function E6Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox={E6_GLYPH_VIEW_BOX} xmlns="http://www.w3.org/2000/svg">
      {E6_GLYPH_PATHS.map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}
