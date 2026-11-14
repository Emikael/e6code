import type { LucideIcon } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

import { playMoment } from "~/lib/motion";

/**
 * A status glyph that settles by scale and fade (board 10) each time `moment`
 * counts up: the user settled or merged what they are looking at. At 0, as
 * when a thread opens already settled, it draws still.
 */
export function SettlingGlyph({
  icon: Icon,
  moment,
  className,
}: {
  icon: LucideIcon;
  /** From `useMomentCount`. */
  moment: number;
  className?: string;
}) {
  const glyphRef = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    if (moment === 0) return;
    const motion = playMoment(glyphRef.current, "settle");
    return () => motion?.cancel();
  }, [moment]);
  return <Icon ref={glyphRef} aria-hidden className={className} />;
}
