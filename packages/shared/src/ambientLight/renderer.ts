/**
 * The WebGL2 side of the ambient light: one context, one program, one draw call per frame.
 * It knows nothing about pacing or pausing; `ambientLight.ts` decides when to draw.
 */
import { AMBIENT_FRAGMENT_SHADER, AMBIENT_VERTEX_SHADER } from "./shader.ts";

/** Colours as 0 to 1 floats. `ray` carries its alpha; `tintAmount` is `--ray-tint`. */
export interface AmbientColors {
  readonly ray: readonly [number, number, number, number];
  readonly tint: readonly [number, number, number];
  readonly tintAmount: number;
}

export interface AmbientFrame {
  readonly timeSeconds: number;
  /** Brightness, 0.55 to 1 through the intro. */
  readonly gain: number;
}

/** The canvas surface the renderer needs; an `HTMLCanvasElement` satisfies it. */
export interface AmbientCanvas {
  width: number;
  height: number;
  getContext(contextId: "webgl2", options: WebGLContextAttributes): WebGL2RenderingContext | null;
  addEventListener(
    type: "webglcontextlost" | "webglcontextrestored",
    listener: (event: Event) => void,
  ): void;
  removeEventListener(
    type: "webglcontextlost" | "webglcontextrestored",
    listener: (event: Event) => void,
  ): void;
}

/** `drawn`, `pending` while a parallel compile runs, or `failed` when the program will not link. */
export type AmbientDrawResult = "drawn" | "pending" | "failed";

export interface AmbientRenderer {
  readonly draw: (frame: AmbientFrame, colors: AmbientColors) => AmbientDrawResult;
  /** Sets the drawing buffer in device pixels; the canvas is scaled up by CSS. */
  readonly resize: (width: number, height: number) => void;
  /** Rebuilds the program after `webglcontextrestored`; false if it cannot. */
  readonly restore: () => boolean;
  /** Releases the context now instead of waiting for garbage collection. */
  readonly release: () => void;
}

export type AmbientRendererStart =
  | { readonly ok: true; readonly renderer: AmbientRenderer }
  | { readonly ok: false; readonly reason: "no-webgl2" | "shader-failed" };

/**
 * `failIfMajorPerformanceCaveat` sends software rendering to the static gradient too, and
 * `low-power` keeps a dual-GPU laptop on its integrated GPU for a soft background.
 */
export const AMBIENT_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  powerPreference: "low-power",
  failIfMajorPerformanceCaveat: true,
};

const UNIFORMS = ["uResolution", "uTime", "uGain", "uRay", "uTint", "uTintAmount"] as const;
type UniformName = (typeof UNIFORMS)[number];

interface Program {
  readonly program: WebGLProgram;
  /** Null until the link is known to have succeeded. */
  uniforms: Record<UniformName, WebGLUniformLocation | null> | null;
}

export const createAmbientRenderer = (canvas: AmbientCanvas): AmbientRendererStart => {
  const gl = canvas.getContext("webgl2", AMBIENT_CONTEXT_ATTRIBUTES);
  if (gl === null) return { ok: false, reason: "no-webgl2" };

  // Lets the driver compile off the main thread; status is polled from frames, not awaited.
  const parallel = gl.getExtension("KHR_parallel_shader_compile") as {
    readonly COMPLETION_STATUS_KHR: number;
  } | null;

  const build = (): Program | null => {
    const program = gl.createProgram();
    if (program === null) return null;
    for (const [type, source] of [
      [gl.VERTEX_SHADER, AMBIENT_VERTEX_SHADER],
      [gl.FRAGMENT_SHADER, AMBIENT_FRAGMENT_SHADER],
    ] as const) {
      const shader = gl.createShader(type);
      if (shader === null) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
      // Flagged for deletion; it lives as long as the program does.
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    return { program, uniforms: null };
  };

  /** True once linked; false while a parallel compile runs; null when the link failed. */
  const ready = (current: Program): boolean | null => {
    if (current.uniforms !== null) return true;
    if (
      parallel !== null &&
      !gl.getProgramParameter(current.program, parallel.COMPLETION_STATUS_KHR)
    ) {
      return false;
    }
    if (!gl.getProgramParameter(current.program, gl.LINK_STATUS)) return null;
    current.uniforms = Object.fromEntries(
      UNIFORMS.map((name) => [name, gl.getUniformLocation(current.program, name)]),
    ) as Record<UniformName, WebGLUniformLocation | null>;
    return true;
  };

  let program = build();
  if (program === null || (parallel === null && ready(program) === null)) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { ok: false, reason: "shader-failed" };
  }

  const renderer: AmbientRenderer = {
    draw: (frame, colors) => {
      if (program === null || gl.isContextLost()) return "pending";
      const state = ready(program);
      if (state === null) return "failed";
      if (!state) return "pending";
      const uniforms = program.uniforms!;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program.program);
      gl.uniform2f(uniforms.uResolution, canvas.width, canvas.height);
      gl.uniform1f(uniforms.uTime, frame.timeSeconds);
      gl.uniform1f(uniforms.uGain, frame.gain);
      gl.uniform4f(uniforms.uRay, ...colors.ray);
      gl.uniform3f(uniforms.uTint, ...colors.tint);
      gl.uniform1f(uniforms.uTintAmount, colors.tintAmount);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return "drawn";
    },
    resize: (width, height) => {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    },
    restore: () => {
      program = build();
      return program !== null && ready(program) !== null;
    },
    release: () => {
      program = null;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
  return { ok: true, renderer };
};
