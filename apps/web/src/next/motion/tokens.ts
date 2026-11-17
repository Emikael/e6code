/**
 * Motion values from `@e6tools/design-tokens/motion`, the only source. CSS reads the same scale
 * as `--dur-*`, `--ease-*`, `--distance-*` and `--spring-*`; `motion` takes seconds, so the
 * engine forms live here.
 */
import { DUR } from "@e6tools/design-tokens/motion";

export {
  DISTANCE,
  DUR,
  EASE,
  EASE_BEZIER,
  SET_PIECE_MS,
  SPRING,
  STAGGER,
} from "@e6tools/design-tokens/motion";

/** `DUR` in seconds, for `motion` transitions. */
export const DUR_S = Object.fromEntries(
  Object.entries(DUR).map(([name, ms]) => [name, ms / 1000]),
) as { readonly [Name in keyof typeof DUR]: number };
