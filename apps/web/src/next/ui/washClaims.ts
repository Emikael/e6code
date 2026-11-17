export type WashKind = "key" | "attention";

/**
 * Who holds each light. A view shows at most one key wash and one attention wash (design
 * direction 4.1): every mounted `LightWash` claims its kind, and only the newest claimant
 * draws. When it leaves, the light returns to the one before it.
 */
export const createWashClaims = () => {
  const claimants: Record<WashKind, string[]> = { key: [], attention: [] };
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    /** Claims `kind` for `id`; returns the way to give it up. */
    claim(kind: WashKind, id: string): () => void {
      claimants[kind].push(id);
      notify();
      return () => {
        const index = claimants[kind].lastIndexOf(id);
        if (index === -1) return;
        claimants[kind].splice(index, 1);
        notify();
      };
    },
    holder: (kind: WashKind): string | undefined => claimants[kind].at(-1),
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
};

/** The page's claims: one window is one view. */
export const washClaims = createWashClaims();
