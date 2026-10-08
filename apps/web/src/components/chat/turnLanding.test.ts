import { describe, expect, it } from "vite-plus/test";
import { TurnId } from "@e6tools/contracts";

import {
  isLiveTurnLanding,
  isTurnLandingPending,
  markTurnLanded,
  settleTurnLanding,
  turnLandingMotion,
} from "./turnLanding";

const turn = (id: string, state: "running" | "completed" | "interrupted" | "error") => ({
  turnId: TurnId.make(id),
  state,
  startedAt: "2026-10-07T10:00:00.000Z",
  completedAt: state === "running" ? null : "2026-10-07T10:01:00.000Z",
});

describe("isLiveTurnLanding", () => {
  it("lands only when the watched turn completes", () => {
    expect(isLiveTurnLanding(turn("a", "running"), turn("a", "completed"))).toBe(true);
  });

  it("stays still for interrupts, errors, history loads, and thread switches", () => {
    expect(isLiveTurnLanding(turn("a", "running"), turn("a", "interrupted"))).toBe(false);
    expect(isLiveTurnLanding(turn("a", "running"), turn("a", "error"))).toBe(false);
    expect(isLiveTurnLanding(null, turn("a", "completed"))).toBe(false);
    expect(isLiveTurnLanding(turn("a", "completed"), turn("a", "completed"))).toBe(false);
    expect(isLiveTurnLanding(turn("a", "running"), turn("b", "completed"))).toBe(false);
  });
});

describe("turnLandingMotion", () => {
  it("settles immediately when reduced motion is on", () => {
    expect(turnLandingMotion(true)).toEqual({ kind: "settle" });
  });

  it("draws the stripe and settles the label without a blur", () => {
    const motion = turnLandingMotion(false);
    expect(motion.kind).toBe("play");
    if (motion.kind !== "play") return;
    expect(motion.label).toEqual({
      opacity: [0.4, 1],
      transform: ["translateY(3px)", "none"],
      duration: 360,
    });
    expect(motion.label).not.toHaveProperty("filter");
    expect(motion.stripe.opacity).toEqual([1, 1, 1, 0]);
    expect(motion.stripe.duration).toBe(1_600);
  });
});

describe("turn landing registry", () => {
  it("is pending until played, then never replays on remount", () => {
    const id = TurnId.make("landing-played");
    markTurnLanded(id, 1_000);
    expect(isTurnLandingPending(id, 1_500)).toBe(true);
    settleTurnLanding(id);
    expect(isTurnLandingPending(id, 1_600)).toBe(false);
  });

  it("expires when the fold row never mounts in time", () => {
    const id = TurnId.make("landing-expired");
    markTurnLanded(id, 1_000);
    expect(isTurnLandingPending(id, 3_500)).toBe(false);
  });
});
