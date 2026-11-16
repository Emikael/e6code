import { describe, expect, it } from "vite-plus/test";

import {
  AMBIENT_INTRO_MS,
  type AmbientColors,
  type AmbientHost,
  type AmbientLight,
  type AmbientState,
  ambientBufferSize,
  bindAmbientHost,
  createAmbientLight,
  describeAmbientState,
} from "./ambientLight.ts";
import { AMBIENT_FRAGMENT_SHADER, AMBIENT_VERTEX_SHADER } from "./shader.ts";
import { createFakeCanvas, createFakeClock, type FakeGlOptions } from "./testing.ts";

const COLORS: AmbientColors = { ray: [1, 1, 1, 0.92], tint: [0.4, 0.3, 0.9], tintAmount: 0.45 };

const start = (
  options: FakeGlOptions & { readonly webgl2?: boolean; readonly playIntro?: boolean } = {},
) => {
  const fake = createFakeClock();
  const gl = createFakeCanvas(options);
  const states: AmbientState[] = [];
  const intro: number[] = [];
  const result = createAmbientLight({
    canvas: gl.canvas,
    clock: fake.clock,
    colors: COLORS,
    playIntro: options.playIntro ?? true,
    onState: (state) => states.push(state),
    onIntro: (progress) => intro.push(progress),
  });
  return { fake, gl, states, intro, result };
};

const started = (options: Parameters<typeof start>[0] = {}) => {
  const setup = start(options);
  if ("static" in setup.result) throw new Error(`static: ${setup.result.static}`);
  return { ...setup, light: setup.result as AmbientLight };
};

describe("ambient light fallbacks", () => {
  it("shows the static gradient without WebGL2", () => {
    expect(start({ webgl2: false }).result).toEqual({ static: "no-webgl2" });
  });

  it("shows the static gradient and releases the context when the shader fails", () => {
    const { result, gl, fake } = start({ linkOk: false });
    expect(result).toEqual({ static: "shader-failed" });
    expect(gl.loseContextCalls()).toBe(1);
    expect(fake.pendingFrames()).toBe(0);
  });

  it("goes static when a parallel compile ends in a failed link", () => {
    const { light, gl, fake } = started({ parallel: true, linkOk: false });
    fake.run(100);
    expect(gl.draws).toHaveLength(0);
    gl.completeCompile();
    fake.run(100);
    expect(light.getState()).toEqual({ kind: "static", reason: "shader-failed" });
    expect(fake.pendingFrames()).toBe(0);
    expect(gl.loseContextCalls()).toBe(1);
  });

  it("waits for a parallel compile without spending intro time", () => {
    const { gl, fake, intro } = started({ parallel: true });
    fake.run(3000);
    expect(gl.draws).toHaveLength(0);
    gl.completeCompile();
    fake.run(100);
    expect(gl.draws.length).toBeGreaterThan(0);
    expect(intro[0]).toBeLessThan(0.2);
  });
});

describe("ambient light intro", () => {
  it("ramps brightness from 0.55 and opacity from 0, then stops writing at 2.4 s", () => {
    const { light, gl, fake, intro, states } = started();
    expect(light.getState()).toEqual({ kind: "running", intro: true });
    fake.run(50);
    expect(gl.draws[0]!.uGain).toBeCloseTo(0.55, 2);
    expect(intro[0]).toBeCloseTo(0, 2);

    fake.run(AMBIENT_INTRO_MS);
    expect(intro.at(-1)).toBe(1);
    expect(intro).toEqual([...intro].sort((a, b) => a - b));
    expect(gl.draws.at(-1)!.uGain).toBe(1);
    expect(states.at(-1)).toEqual({ kind: "running", intro: false });

    const writes = intro.length;
    fake.run(5000);
    expect(intro).toHaveLength(writes);
    expect(gl.draws.at(-1)!.uGain).toBe(1);
  });

  it("does not replay: playIntro false writes full opacity once and draws at full gain", () => {
    const { light, gl, fake, intro } = started({ playIntro: false });
    expect(light.getState()).toEqual({ kind: "running", intro: false });
    fake.run(1000);
    expect(intro).toEqual([1]);
    expect(gl.draws[0]!.uGain).toBe(1);
  });

  it("freezes the intro while paused", () => {
    const { light, fake, intro } = started();
    fake.run(1000);
    light.setPaused("hidden", true);
    const at = intro.at(-1)!;
    fake.run(5000);
    expect(intro.at(-1)).toBe(at);
    expect(light.getState()).toEqual({ kind: "paused", reasons: ["hidden"] });
    light.setPaused("hidden", false);
    fake.run(100);
    expect(intro.at(-1)!).toBeLessThan(1);
  });

  it("rests after 10 s without input, then input wakes it", () => {
    const { light, fake } = started();
    fake.run(10_100);
    expect(fake.pendingFrames()).toBe(0);
    expect(light.getState()).toEqual({ kind: "paused", reasons: ["idle"] });
    light.input();
    expect(light.getState()).toEqual({ kind: "running", intro: false });
    expect(fake.pendingFrames()).toBe(1);
  });
});

describe("ambient light context loss", () => {
  it("shows static on loss and resumes after restore with one frame", () => {
    const { light, gl, fake } = started();
    fake.run(500);
    expect(gl.loseContext()).toBe(true);
    expect(light.getState()).toEqual({ kind: "static", reason: "context-lost" });
    expect(fake.pendingFrames()).toBe(0);

    const draws = gl.draws.length;
    gl.restoreContext();
    expect(gl.draws).toHaveLength(draws + 1);
    expect(light.getState().kind).toBe("running");
    expect(fake.pendingFrames()).toBe(1);
  });

  it("stays paused after a restore when a pause reason holds", () => {
    const { light, gl, fake } = started();
    light.setPaused("blurred", true);
    gl.loseContext();
    const draws = gl.draws.length;
    gl.restoreContext();
    expect(gl.draws).toHaveLength(draws + 1);
    expect(light.getState()).toEqual({ kind: "paused", reasons: ["blurred"] });
    expect(fake.pendingFrames()).toBe(0);
  });

  it("stays static until remount after a second loss", () => {
    const { light, gl, fake } = started();
    gl.loseContext();
    gl.restoreContext();
    gl.loseContext();
    expect(light.getState()).toEqual({ kind: "static", reason: "context-lost-twice" });
    expect(fake.pendingFrames()).toBe(0);
    gl.restoreContext();
    expect(light.getState()).toEqual({ kind: "static", reason: "context-lost-twice" });
    expect(gl.listenerCount()).toBe(0);
  });

  it("releases the context on destroy without counting it as a loss", () => {
    const { light, gl, fake, states } = started();
    fake.run(100);
    light.destroy();
    expect(gl.loseContextCalls()).toBe(1);
    expect(gl.listenerCount()).toBe(0);
    expect(fake.pendingFrames()).toBe(0);
    expect(states.some((s) => s.kind === "static")).toBe(false);
  });
});

describe("ambient light size and colour", () => {
  it("renders at half of a device pixel ratio capped at 1.5", () => {
    expect(ambientBufferSize(800, 1)).toBe(400);
    expect(ambientBufferSize(800, 2)).toBe(600);
    expect(ambientBufferSize(800, 3)).toBe(600);
    expect(ambientBufferSize(0, 2)).toBe(1);
  });

  it("redraws one frame on resize or theme change while paused", () => {
    const { light, gl, fake } = started();
    fake.run(200);
    light.setPaused("offscreen", true);
    const draws = gl.draws.length;

    light.resize(1000, 500, 2);
    expect([gl.canvas.width, gl.canvas.height]).toEqual([750, 375]);
    expect(gl.draws).toHaveLength(draws + 1);

    light.setColors({ ...COLORS, ray: [0.5, 0.4, 1, 0.3], tintAmount: 0 });
    expect(gl.draws).toHaveLength(draws + 2);
    expect(gl.draws.at(-1)!.uRay).toEqual([0.5, 0.4, 1, 0.3]);
    expect(fake.pendingFrames()).toBe(0);
  });

  it("does not draw an extra frame on resize while running", () => {
    const { light, gl, fake } = started();
    fake.run(100);
    const draws = gl.draws.length;
    light.resize(400, 300, 1);
    expect(gl.draws).toHaveLength(draws);
  });
});

describe("ambient host bindings", () => {
  const host = (initial: { hidden?: boolean; focused?: boolean } = {}) => {
    const document = Object.assign(new EventTarget(), {
      hidden: initial.hidden ?? false,
      hasFocus: () => initial.focused ?? true,
    });
    const window = Object.assign(new EventTarget(), { devicePixelRatio: 2 });
    let intersect: ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined;
    let disconnected = 0;
    class FakeIntersectionObserver {
      constructor(callback: typeof intersect) {
        intersect = callback;
      }
      observe() {}
      disconnect() {
        disconnected += 1;
      }
    }
    const element = { clientWidth: 640, clientHeight: 480 };
    return {
      document,
      window,
      host: {
        document,
        window,
        element,
        IntersectionObserver: FakeIntersectionObserver,
      } as unknown as AmbientHost,
      intersect: (isIntersecting: boolean) => intersect?.([{ isIntersecting }]),
      disconnected: () => disconnected,
    };
  };

  it("pauses when hidden, blurred or off screen, and sizes the buffer", () => {
    const { light, gl, fake } = started();
    const env = host({ focused: false });
    const unbind = bindAmbientHost(light, env.host);
    expect([gl.canvas.width, gl.canvas.height]).toEqual([480, 360]);
    expect(light.getState()).toEqual({ kind: "paused", reasons: ["blurred"] });

    env.window.dispatchEvent(new Event("focus"));
    expect(light.getState().kind).toBe("running");

    env.document.hidden = true;
    env.document.dispatchEvent(new Event("visibilitychange"));
    env.intersect(false);
    expect(light.getState()).toEqual({ kind: "paused", reasons: ["hidden", "offscreen"] });
    expect(fake.pendingFrames()).toBe(0);

    unbind();
    expect(env.disconnected()).toBe(1);
    env.window.dispatchEvent(new Event("blur"));
    expect(light.getState()).toEqual({ kind: "paused", reasons: ["hidden", "offscreen"] });
  });

  it("wakes from idle on input events", () => {
    const { light, fake } = started();
    const env = host();
    bindAmbientHost(light, env.host);
    fake.run(10_100);
    expect(light.getState()).toEqual({ kind: "paused", reasons: ["idle"] });
    env.window.dispatchEvent(new Event("pointermove"));
    expect(light.getState().kind).toBe("running");
  });

  it("pauses while the focused thread streams", () => {
    const { light, fake } = started();
    light.setPaused("streaming", true);
    expect(fake.pendingFrames()).toBe(0);
    expect(describeAmbientState(light.getState())).toBe(
      "Paused on current frame: focused thread streaming",
    );
  });
});

describe("ambient light budget and readout", () => {
  it("keeps the shader source under 8 KB", () => {
    const bytes = new TextEncoder().encode(AMBIENT_VERTEX_SHADER + AMBIENT_FRAGMENT_SHADER);
    expect(bytes.length).toBeLessThanOrEqual(8 * 1024);
  });

  it("uses the design's readout strings", () => {
    expect(describeAmbientState({ kind: "running", intro: true })).toBe("Running: 2.4 s intro");
    expect(describeAmbientState({ kind: "running", intro: false })).toBe(
      "Running: slow drift, 30 fps",
    );
    expect(describeAmbientState({ kind: "paused", reasons: ["hidden", "idle"] })).toBe(
      "Paused on current frame: tab hidden, 10 s without input",
    );
    expect(describeAmbientState({ kind: "static", reason: "reduced" })).toBe(
      "Static gradient: Motion is Reduced",
    );
    expect(describeAmbientState({ kind: "static", reason: "context-lost-twice" })).toBe(
      "Static gradient: Context lost twice: static until remount",
    );
  });
});
