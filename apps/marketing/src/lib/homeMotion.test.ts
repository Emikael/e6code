import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { startHomeMotion } from "./homeMotion";

class ElementStub extends EventTarget {
  properties = new Map<string, string>();
  style = { setProperty: (name: string, value: string) => this.properties.set(name, value) };
}

let observers: ObserverStub[] = [];
class ObserverStub {
  constructor(private readonly callback: IntersectionObserverCallback) {
    observers.push(this);
  }
  observe = vi.fn();
  disconnect = vi.fn();
  report(target: ElementStub, isIntersecting: boolean) {
    this.callback(
      [{ target, isIntersecting } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

let page = Object.assign(new EventTarget(), { visibilityState: "visible" });
let reduced = Object.assign(new EventTarget(), { matches: false });
let dispose: (() => void) | undefined;

beforeEach(() => {
  observers = [];
  page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  reduced = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { matchMedia: () => reduced }));
  vi.stubGlobal("IntersectionObserver", ObserverStub);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
});

function fixture() {
  const first = new ElementStub();
  const second = new ElementStub();
  dispose = startHomeMotion([first, second] as unknown as HTMLElement[]);
  return { first, second, observer: observers[0]! };
}

const state = (element: ElementStub) => element.properties.get("--home-motion-state");

describe("homepage motion", () => {
  it("runs each element only while it is visible, the tab is shown, and motion is allowed", () => {
    const { first, second, observer } = fixture();
    expect(state(first)).toBe("paused");
    observer.report(first, true);
    expect(state(first)).toBe("running");
    expect(state(second)).toBe("paused");

    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
    expect(state(first)).toBe("paused");
    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    expect(state(first)).toBe("running");

    reduced.matches = true;
    reduced.dispatchEvent(new Event("change"));
    expect(state(first)).toBe("paused");
    reduced.matches = false;
    reduced.dispatchEvent(new Event("change"));
    expect(state(first)).toBe("running");

    observer.report(first, false);
    expect(state(first)).toBe("paused");
  });

  it("pauses everything and ignores events after cleanup", () => {
    const { first, observer } = fixture();
    observer.report(first, true);
    dispose?.();
    observer.report(first, true);
    reduced.dispatchEvent(new Event("change"));
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(state(first)).toBe("paused");
  });
});
