export type WashKind = "key" | "attention";

/**
 * Who holds each light. A view shows at most one key wash and one attention wash (design
 * direction 4.1): every mounted `LightWash` claims its kind, and only the holder draws. The
 * holder is the newest claimant that is on, so a wash that is off never takes the light from
 * one that is on. A wash claims again each time it turns on or off, so the newest is the one
 * that mounted or changed last, not the one lowest in the tree. When the holder leaves or
 * turns off, the light returns to the one before it.
 */
export const createWashClaims = () => {
  const claimants: Record<WashKind, Array<{ readonly id: string; readonly on: boolean }>> = {
    key: [],
    attention: [],
  };
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    /** Claims `kind` for `id`, saying whether its wash is on; returns the way to give it up. */
    claim(kind: WashKind, id: string, on: boolean): () => void {
      const claimant = { id, on };
      claimants[kind].push(claimant);
      notify();
      return () => {
        const index = claimants[kind].indexOf(claimant);
        if (index === -1) return;
        claimants[kind].splice(index, 1);
        notify();
      };
    },
    /** With none on, the newest claimant keeps the place: it stays mounted to fade back in. */
    holder: (kind: WashKind): string | undefined =>
      (claimants[kind].findLast((claimant) => claimant.on) ?? claimants[kind].at(-1))?.id,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
};

/** The page's claims: one window is one view. */
export const washClaims = createWashClaims();
