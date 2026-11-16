import { BRAND_GLYPH } from "@e6tools/design-tokens/brand";
import type { SVGProps } from "react";

export function E6Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox={BRAND_GLYPH.viewBox} xmlns="http://www.w3.org/2000/svg">
      <path d={BRAND_GLYPH.path} fillRule="evenodd" fill="currentColor" />
    </svg>
  );
}
