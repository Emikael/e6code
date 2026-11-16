import { type RefObject, useEffect, useState } from "react";

interface ObserverEntry {
  readonly target: Element;
  readonly isIntersecting: boolean;
}

interface Observer {
  observe(target: Element): void;
  unobserve(target: Element): void;
  disconnect(): void;
}

type CreateObserver = (callback: (entries: ReadonlyArray<ObserverEntry>) => void) => Observer;

/**
 * One shared observer for every element whose motion is viewport-only (`reveal`, `layout`,
 * stagger). It exists while at least one element is watched.
 */
export const createViewportTracker = (createObserver: CreateObserver | undefined) => {
  const listeners = new Map<Element, (inViewport: boolean) => void>();
  let observer: Observer | undefined;

  return {
    /** Watches `target`; returns the way to stop. Without an observer nothing is reported. */
    watch(target: Element, onChange: (inViewport: boolean) => void): () => void {
      if (createObserver === undefined) return () => undefined;
      observer ??= createObserver((entries) => {
        for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
      });
      listeners.set(target, onChange);
      observer.observe(target);
      return () => {
        if (listeners.get(target) !== onChange) return;
        listeners.delete(target);
        observer?.unobserve(target);
        if (listeners.size === 0) {
          observer?.disconnect();
          observer = undefined;
        }
      };
    },
    watchedCount: () => listeners.size,
  };
};

const viewportTracker = createViewportTracker(
  typeof IntersectionObserver === "undefined"
    ? undefined
    : (callback) => new IntersectionObserver((entries) => callback(entries)),
);

/**
 * Whether the element is on screen, for motion that plays only there. `override` wins: a
 * virtualised list knows better than the observer (E01-T20 feeds it). Until the first report
 * an element counts as on screen.
 */
export const useInViewport = (ref: RefObject<Element | null>, override?: boolean): boolean => {
  const [observed, setObserved] = useState(true);
  useEffect(() => {
    if (override !== undefined || ref.current === null) return;
    return viewportTracker.watch(ref.current, setObserved);
  }, [ref, override]);
  return override ?? observed;
};
