/**
 * Fakes for the ambient light tests: a frame scheduler driven by a fake clock, and just enough
 * of WebGL2 to see what the renderer draws.
 */
import type { AmbientClock } from "./frameLoop.ts";
import type { AmbientCanvas } from "./renderer.ts";

export const createFakeClock = () => {
  let now = 0;
  let nextHandle = 1;
  const pending = new Map<number, (time: number) => void>();
  const clock: AmbientClock = {
    now: () => now,
    requestFrame: (callback) => {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      pending.delete(handle);
    },
  };
  return {
    clock,
    pendingFrames: () => pending.size,
    now: () => now,
    /** Advances `ms` at a display of `hz`, firing each frame's callbacks at its timestamp. */
    run: (ms: number, hz = 60) => {
      const end = now + ms;
      const step = 1000 / hz;
      while (now + step <= end + 1e-6) {
        now += step;
        const callbacks = [...pending.values()];
        pending.clear();
        for (const callback of callbacks) callback(now);
      }
      now = end;
    },
  };
};

export interface FakeGlOptions {
  readonly linkOk?: boolean;
  /** Present `KHR_parallel_shader_compile`, still compiling until `completeCompile()`. */
  readonly parallel?: boolean;
}

export const createFakeCanvas = (options: FakeGlOptions & { readonly webgl2?: boolean } = {}) => {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const fire = (type: string) => {
    const event = new Event(type, { cancelable: true });
    for (const listener of listeners.get(type) ?? []) listener(event);
    return event;
  };
  let compiled = !options.parallel;
  let contextLost = false;
  let loseContextCalls = 0;
  const draws: Array<Record<string, unknown>> = [];
  let uniforms: Record<string, unknown> = {};

  const COMPLETION_STATUS_KHR = 0x91b1;
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    LINK_STATUS: 3,
    COLOR_BUFFER_BIT: 4,
    TRIANGLES: 5,
    getExtension: (name: string) => {
      if (name === "KHR_parallel_shader_compile") {
        return options.parallel ? { COMPLETION_STATUS_KHR } : null;
      }
      if (name === "WEBGL_lose_context") {
        return {
          loseContext: () => {
            loseContextCalls += 1;
            contextLost = true;
            fire("webglcontextlost");
          },
        };
      }
      return null;
    },
    createProgram: () => ({}),
    createShader: () => ({}),
    shaderSource: () => undefined,
    compileShader: () => undefined,
    attachShader: () => undefined,
    deleteShader: () => undefined,
    linkProgram: () => undefined,
    getProgramParameter: (_program: unknown, parameter: number) =>
      parameter === COMPLETION_STATUS_KHR ? compiled : (options.linkOk ?? true),
    getUniformLocation: (_program: unknown, name: string) => name,
    isContextLost: () => contextLost,
    viewport: () => undefined,
    clearColor: () => undefined,
    clear: () => undefined,
    useProgram: () => {
      uniforms = {};
    },
    uniform1f: (name: string, value: number) => {
      uniforms[name] = value;
    },
    uniform2f: (name: string, ...value: number[]) => {
      uniforms[name] = value;
    },
    uniform3f: (name: string, ...value: number[]) => {
      uniforms[name] = value;
    },
    uniform4f: (name: string, ...value: number[]) => {
      uniforms[name] = value;
    },
    drawArrays: () => {
      draws.push(uniforms);
    },
  };

  const canvas: AmbientCanvas = {
    width: 300,
    height: 150,
    getContext: () => (options.webgl2 === false ? null : (gl as unknown as WebGL2RenderingContext)),
    addEventListener: (type, listener) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener);
    },
  };

  return {
    canvas,
    draws,
    loseContextCalls: () => loseContextCalls,
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    completeCompile: () => {
      compiled = true;
    },
    /** The browser losing the context; returns whether the handler asked for a restore. */
    loseContext: () => {
      contextLost = true;
      return fire("webglcontextlost").defaultPrevented;
    },
    restoreContext: () => {
      contextLost = false;
      fire("webglcontextrestored");
    },
  };
};
