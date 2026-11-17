import { useId, useLayoutEffect, useSyncExternalStore } from "react";

import "./planes.css";
import { washClaims, type WashKind } from "./washClaims.ts";

/**
 * The light behind what is live (`key`) or what waits for the user (`attention`). It fills
 * its positioned parent, which is sized to what it lights, and shows or hides by opacity.
 * `enter` fades it in on mount, for light that arrives with new content.
 *
 * A view draws one wash per kind: when several are on, only the one that mounted or turned on
 * last renders, and the light moves between them as a cut.
 * Decorative, so hidden from assistive technology; the state it marks needs its own words.
 */
export function LightWash({
  kind,
  on = true,
  enter = false,
}: {
  readonly kind: WashKind;
  readonly on?: boolean;
  readonly enter?: boolean;
}) {
  const id = useId();
  useLayoutEffect(() => washClaims.claim(kind, id, on), [kind, id, on]);
  const holds = useSyncExternalStore(
    washClaims.subscribe,
    () => washClaims.holder(kind) === id,
    () => false,
  );
  if (!holds) return null;
  return (
    <div
      className="light-wash"
      aria-hidden="true"
      data-kind={kind}
      data-on={on ? "" : undefined}
      data-enter={enter ? "" : undefined}
    />
  );
}
