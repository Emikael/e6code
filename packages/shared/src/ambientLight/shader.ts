/**
 * The ambient light shader, GLSL ES 3.0, first-party. Written from the idea of light falling
 * through slats from above the top edge; no third-party shader code (design-sourcing register,
 * "Ambient light shader"). The composition matches `ambient.css`: the source sits above the
 * top centre and the rays fan about ±0.9 rad around straight down.
 */

/** A full-screen triangle from `gl_VertexID`, so no vertex buffer is needed. */
export const AMBIENT_VERTEX_SHADER = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * Three angular bands (12, 19 and 31 cycles) drift at 0.03 to 0.08 rad/s under a radial
 * falloff and a cone; the source sways ±0.03 over about two minutes. Output is premultiplied
 * over a transparent clear, so the canvas adds to the static wash below it.
 */
export const AMBIENT_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform vec2 uResolution;
uniform float uTime;
uniform float uGain;
uniform vec4 uRay;
uniform vec3 uTint;
uniform float uTintAmount;
out vec4 outColor;

float band(float angle, float cycles, float speed, float phase, float sharpness) {
  return pow(0.5 + 0.5 * sin(angle * cycles + uTime * speed + phase), sharpness);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 source = vec2(0.5 + 0.03 * sin(uTime * 0.0524), 1.22);
  vec2 d = uv - source;
  d.x *= uResolution.x / uResolution.y;
  float r = length(d);
  float angle = atan(d.x, -d.y);

  float cone = 1.0 - smoothstep(0.55, 0.9, abs(angle));
  float rays = 0.5 * band(angle, 12.0, 0.05, 0.7, 3.0)
    + 0.32 * band(angle, 19.0, -0.03, 2.1, 4.0)
    + 0.18 * band(angle, 31.0, 0.08, 4.3, 6.0);
  float falloff = exp(-1.8 * max(r - 0.22, 0.0)) * (1.0 - smoothstep(0.9, 1.35, r));
  float light = (0.15 + 0.85 * rays) * cone * falloff;

  // Interleaved gradient noise, a dither against banding in the soft gradient.
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float alpha = clamp(uRay.a * light * uGain + (noise - 0.5) / 255.0, 0.0, 1.0);
  float near = 1.0 - smoothstep(0.22, 0.8, r);
  vec3 color = mix(uRay.rgb, uTint, uTintAmount * near);
  outColor = vec4(color * alpha, alpha);
}
`;
