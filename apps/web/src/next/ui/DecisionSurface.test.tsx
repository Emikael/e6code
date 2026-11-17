import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DecisionSurface } from "./DecisionSurface.tsx";

type AnimationEventType = "animationend" | "animationcancel";

/** Stands in for the card's element: it keeps the animation listeners the surface adds. */
const createCard = () => {
  const listeners = new Map<string, (event: unknown) => void>();
  return {
    listeners,
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      void listeners.set(type, listener),
    removeEventListener: (type: string) => void listeners.delete(type),
  };
};

let renderer: ReactTestRenderer | null = null;
let card = createCard();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  card = createCard();
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

/** Each test uses its own request id: the sweep ledger is per page. */
const mount = async (requestId: string) => {
  await act(() => {
    renderer = create(<DecisionSurface requestId={requestId}>Approve?</DecisionSurface>, {
      createNodeMock: () => card,
    });
  });
};

/** An animation event of the card's own ring, unless `target` says it came from inside. */
const fire = (type: AnimationEventType, animationName: string, target: object = card) =>
  act(() => card.listeners.get(type)?.({ type, animationName, target }));

/** Whether the card still carries the trigger that plays the sweep. */
const armed = () =>
  renderer!.root.findByProps({ "data-plane": "raised" }).props["data-enter"] === "";

describe("DecisionSurface sweep", () => {
  it("keeps its trigger through the rise and drops it once the ring has settled", async () => {
    await mount("settles");
    expect(armed()).toBe(true);

    await fire("animationend", "motion-sweep-rise");
    expect(armed()).toBe(true);

    await fire("animationend", "motion-sweep-settle");
    expect(armed()).toBe(false);
  });

  // Reduced and Off cancel the sweep. With the trigger left on, a return to Full plays it again.
  it.each(["motion-sweep-rise", "motion-sweep-settle"])(
    "drops its trigger when the sweep is cut short during %s",
    async (animationName) => {
      await mount(`cut-short-${animationName}`);

      await fire("animationcancel", animationName);
      expect(armed()).toBe(false);
    },
  );

  it("ignores the animations of what is inside the card", async () => {
    await mount("content");

    await fire("animationcancel", "motion-sweep-rise", {});
    await fire("animationend", "motion-sweep-settle", {});
    await fire("animationend", "motion-skeleton");
    expect(armed()).toBe(true);
  });

  it("mounts without the trigger when the request has already swept", async () => {
    await mount("remounts");
    await act(() => renderer?.unmount());

    await mount("remounts");
    expect(armed()).toBe(false);
  });
});
