import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { MOTION_RECIPES } from "../motion/index.ts";
import { LightWash } from "./LightWash.tsx";
import { Plane } from "./Plane.tsx";
import { sweepLedger } from "./sweepLedger.ts";

interface DecisionSurfaceProps {
  /** The approval or question this surface is for. Its ring sweeps once per id. */
  readonly requestId: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * The shell of the one place an approval or question appears: a raised card at the frontier,
 * attached to the composer, with the attention wash under it and one `sweep` of its ring.
 * It needs `MotionRoot` above it, which loads the sweep. Place it through a positioned wrapper:
 * a position class in `className` does not apply (see `planes.css`).
 *
 * It draws the shell only. The content, the words that say a decision is waiting, focus and
 * the arrival choreography belong to the screen (E02-T12, E16).
 */
export function DecisionSurface({ requestId, ...props }: DecisionSurfaceProps) {
  return <DecisionShell key={requestId} requestId={requestId} {...props} />;
}

function DecisionShell({ requestId, className, children }: DecisionSurfaceProps) {
  const [sweeping, setSweeping] = useState(() => sweepLedger.isNew(requestId));
  useEffect(() => sweepLedger.record(requestId), [requestId]);

  const card = useRef<HTMLDivElement>(null);
  // The trigger goes once the ring has settled, and also when the sweep is cut short: Reduced
  // and Off cancel it, and a trigger left on would play it again on the way back to Full.
  // React has no `onAnimationCancel`, so both events are listened for on the element.
  useLayoutEffect(() => {
    const element = card.current;
    if (!sweeping || !element) return;
    const drop = (event: AnimationEvent) => {
      // The ring's events target the card; anything else bubbled up from the content.
      if (event.target !== element) return;
      const settled =
        event.type === "animationend" && event.animationName === "motion-sweep-settle";
      const cutShort =
        event.type === "animationcancel" && event.animationName.startsWith("motion-sweep-");
      if (settled || cutShort) setSweeping(false);
    };
    element.addEventListener("animationend", drop);
    element.addEventListener("animationcancel", drop);
    return () => {
      element.removeEventListener("animationend", drop);
      element.removeEventListener("animationcancel", drop);
    };
  }, [sweeping]);

  return (
    <div className={className ? `decision-surface ${className}` : "decision-surface"}>
      <LightWash kind="attention" enter={sweeping} />
      <Plane
        ref={card}
        level="raised"
        className={`rounded-card ${MOTION_RECIPES.sweep}`}
        data-enter={sweeping ? "" : undefined}
      >
        {children}
      </Plane>
    </div>
  );
}
