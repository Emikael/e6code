export type ImportedCookieApprovalState =
  | { readonly status: "idle" }
  | { readonly status: "confirming"; readonly message: string }
  | { readonly status: "closing"; readonly message: string };

const idleState: ImportedCookieApprovalState = { status: "idle" };
let state: ImportedCookieApprovalState = idleState;
let active: { readonly resolve: (allowed: boolean) => void } | null = null;
let registeredHostCount = 0;
const listeners = new Set<() => void>();

function publish(next: ImportedCookieApprovalState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function readImportedCookieApprovalState(): ImportedCookieApprovalState {
  return state;
}

export function subscribeImportedCookieApproval(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function registerImportedCookieApprovalHost(): () => void {
  registeredHostCount += 1;
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    registeredHostCount = Math.max(0, registeredHostCount - 1);
    if (registeredHostCount === 0 && active) {
      const pending = active;
      active = null;
      pending.resolve(false);
      publish(idleState);
    }
  };
}

/**
 * Shows one imported-cookie approval. A second call while one is open resolves
 * false immediately and is not queued, so it cannot be answered by an
 * unrelated confirmation.
 */
export function requestImportedCookieApproval(message: string): Promise<boolean> {
  if (registeredHostCount === 0 || active || state.status !== "idle") {
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    active = { resolve };
    publish({ status: "confirming", message });
  });
}

export function respondToImportedCookieApproval(allowed: boolean): void {
  if (state.status !== "confirming" || !active) return;
  const pending = active;
  active = null;
  pending.resolve(allowed);
  publish({ status: "closing", message: state.message });
}

export function completeImportedCookieApprovalClose(): void {
  if (state.status !== "closing") return;
  publish(idleState);
}
