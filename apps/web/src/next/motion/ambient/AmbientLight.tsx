import { describeAmbientState } from "@e6tools/shared/ambientLightState";
import { useEffect, useRef, useState } from "react";

import { useMotionPolicy } from "../policy.ts";
import { AmbientStatic } from "./AmbientStatic.tsx";
import type { LiveCanvas } from "./liveCanvas.ts";
import {
  type AmbientSurface,
  claimAmbientCanvas,
  decideAmbient,
  TOUCH_FIRST_QUERY,
} from "./surfaces.ts";

const isTouchFirst = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(TOUCH_FIRST_QUERY).matches;

/**
 * The ambient light for an allowed surface. The static gradient paints first; at Full, on a
 * pointer device, and when this window's canvas is free, the renderer chunk loads after first
 * paint and fades the canvas in over 2.4 s. Under Reduced or Off it stays static and holds no
 * WebGL context. Fills its positioned parent.
 *
 * `streaming` pauses it while the focused thread streams.
 */
export function AmbientLight(props: {
  readonly surface: AmbientSurface;
  readonly streaming?: boolean;
  readonly className?: string;
}) {
  const { surface, streaming = false } = props;
  const level = useMotionPolicy();
  const [touchFirst] = useState(isTouchFirst);
  const gate = decideAmbient({ level, surface, touchFirst });
  const containerRef = useRef<HTMLDivElement>(null);
  const raysRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<LiveCanvas | null>(null);
  // Per mount: once the intro has played, a return to Full starts at the drift.
  const introPlayedRef = useRef(false);
  const streamingRef = useRef(streaming);

  useEffect(() => {
    streamingRef.current = streaming;
    liveRef.current?.setStreaming(streaming);
  }, [streaming]);

  useEffect(() => {
    if (!gate.live) return;
    const container = containerRef.current;
    const rays = raysRef.current;
    if (!container || !rays) return;
    // The live readout is written straight to the DOM: pausing and resuming must not
    // re-render the surface above it.
    const readout = (text: string) => {
      container.dataset.ambient = text;
    };
    const release = claimAmbientCanvas();
    if (release === null) {
      readout(describeAmbientState({ kind: "static", reason: "canvas-in-use" }));
      return;
    }
    let cancelled = false;
    void import("./liveCanvas.ts").then(
      ({ startLiveCanvas }) => {
        if (cancelled) return;
        liveRef.current = startLiveCanvas({
          container,
          rays,
          playIntro: !introPlayedRef.current,
          streaming: streamingRef.current,
          onIntroStart: () => {
            introPlayedRef.current = true;
          },
          onState: (state) => readout(describeAmbientState(state)),
        });
      },
      // A chunk that fails to load leaves the static gradient, which is already painted.
      () => undefined,
    );
    return () => {
      cancelled = true;
      liveRef.current?.stop();
      liveRef.current = null;
      release();
    };
  }, [gate.live]);

  return (
    <AmbientStatic
      ref={containerRef}
      raysRef={raysRef}
      {...(props.className === undefined ? {} : { className: props.className })}
      {...(gate.live
        ? {}
        : { "data-ambient": describeAmbientState({ kind: "static", reason: gate.reason }) })}
    />
  );
}
