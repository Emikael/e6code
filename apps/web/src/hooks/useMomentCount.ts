import { useState } from "react";

import { nextMomentWatch, type MomentWatch } from "../lib/motion";

/**
 * How many times `value` turned on while `key` stayed in view. Pass it as a
 * moment to the element that should settle; it starts at 0 for each key, so a
 * thread opened in a state plays nothing.
 */
export function useMomentCount(key: string | null, value: boolean): number {
  const [watch, setWatch] = useState<MomentWatch>({ key, value, count: 0 });
  if (watch.key === key && watch.value === value) return watch.count;
  const next = nextMomentWatch(watch, key, value);
  setWatch(next);
  return next.count;
}
