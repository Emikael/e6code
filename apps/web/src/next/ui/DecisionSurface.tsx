import { type ReactNode, useEffect, useState } from "react";

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
 * It needs `MotionRoot` above it, which loads the sweep.
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
  return (
    <div className={className ? `decision-surface ${className}` : "decision-surface"}>
      <LightWash kind="attention" enter={sweeping} />
      <Plane
        level="raised"
        className={`rounded-card ${MOTION_RECIPES.sweep}`}
        data-enter={sweeping ? "" : undefined}
        // Once the ring has settled, drop the trigger so a motion-level change cannot replay it.
        onAnimationEnd={(event) => {
          if (event.animationName === "motion-sweep-settle") setSweeping(false);
        }}
      >
        {children}
      </Plane>
    </div>
  );
}
