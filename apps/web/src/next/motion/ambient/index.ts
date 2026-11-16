/**
 * The ambient light (D12): a live canvas on welcome and pairing, the static gradient
 * everywhere else it is shown. Its own entry, not re-exported from `next/motion`, so the
 * motion barrel never pulls WebGL code; the renderer itself loads lazily from `AmbientLight`.
 *
 * Importers are allow-listed in `allowedImporters.test.ts`. Never mount it behind a working
 * screen (timeline, composer, diff, terminal, settings, sidebar or any list).
 */
export { AmbientLight } from "./AmbientLight.tsx";
export { AmbientStatic } from "./AmbientStatic.tsx";
export { AMBIENT_SURFACES, type AmbientSurface } from "./surfaces.ts";
