/**
 * The lazy half of `AmbientLight`: loaded with `import()` after first paint, only when the
 * gate passes, so WebGL code never reaches the entry or the chat route. It creates the
 * canvas, binds the browser inputs and keeps the canvas and static rays' opacity in step.
 */
import {
  type AmbientState,
  bindAmbientHost,
  createAmbientLight,
  isTerminalAmbientState,
} from "@e6tools/shared/ambientLight";

import { readAmbientColors, watchThemeChanges } from "./colorProbe.ts";

export interface LiveCanvas {
  readonly setStreaming: (streaming: boolean) => void;
  readonly stop: () => void;
}

export const startLiveCanvas = (options: {
  readonly container: HTMLElement;
  readonly rays: HTMLElement;
  readonly playIntro: boolean;
  readonly streaming: boolean;
  /** Called on the first intro frame, so a later remount does not replay it. */
  readonly onIntroStart: () => void;
  readonly onState: (state: AmbientState) => void;
}): LiveCanvas => {
  const { container, rays, onState } = options;
  const canvas = document.createElement("canvas");
  canvas.className = "ambient-light__canvas";
  canvas.setAttribute("aria-hidden", "true");
  container.append(canvas);

  // The canvas fades in over the static rays; a lost context shows the rays alone.
  let introProgress = 0;
  const showCanvas = (visible: boolean) => {
    const progress = visible ? introProgress : 0;
    canvas.style.opacity = String(progress);
    rays.style.opacity = String(1 - progress);
  };

  let stopped = false;
  let unbind = () => {};
  let unwatch = () => {};
  const stop = () => {
    if (stopped) return;
    stopped = true;
    unwatch();
    unbind();
    light.destroy();
    canvas.remove();
    rays.style.opacity = "";
  };

  const created = createAmbientLight({
    canvas,
    clock: {
      now: () => performance.now(),
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
    },
    colors: readAmbientColors(container),
    playIntro: options.playIntro,
    onIntro: (progress) => {
      if (introProgress === 0) options.onIntroStart();
      introProgress = progress;
      showCanvas(true);
    },
    onState: (state) => {
      showCanvas(state.kind !== "static");
      if (isTerminalAmbientState(state)) stop();
      onState(state);
    },
  });

  if ("static" in created) {
    canvas.remove();
    onState({ kind: "static", reason: created.static });
    return { setStreaming: () => {}, stop: () => {} };
  }
  const light = created;
  light.setPaused("streaming", options.streaming);
  unbind = bindAmbientHost(light, {
    document,
    window,
    element: container,
    ...(typeof IntersectionObserver === "undefined" ? {} : { IntersectionObserver }),
    ...(typeof ResizeObserver === "undefined" ? {} : { ResizeObserver }),
  });
  unwatch = watchThemeChanges(() => {
    if (!stopped) light.setColors(readAmbientColors(container));
  });
  onState(light.getState());

  return {
    setStreaming: (streaming) => {
      if (!stopped) light.setPaused("streaming", streaming);
    },
    stop,
  };
};
