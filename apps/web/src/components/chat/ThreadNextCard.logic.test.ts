import { TurnId } from "@e6tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveNextCard, formatNextCardChanges } from "./ThreadNextCard.logic";

const turnId = TurnId.make("turn-2");
const finished = {
  latestTurn: { turnId, state: "completed", diffStat: { insertions: 66, deletions: 13 } },
  isWorking: false,
  waitingOnYou: false,
  settled: false,
  checkpoints: [{ turnId, files: [{}, {}, {}] }],
};

describe("deriveNextCard", () => {
  it("offers the next step after a turn that finished with changes", () => {
    const state = deriveNextCard(finished);
    expect(state).toEqual({ turnId, fileCount: 3, insertions: 66, deletions: 13 });
    expect(formatNextCardChanges(state!)).toBe("3 files +66 −13");
  });

  it("stays away while the agent works, waits on you, or after you settle", () => {
    expect(deriveNextCard({ ...finished, isWorking: true })).toBeNull();
    expect(deriveNextCard({ ...finished, waitingOnYou: true })).toBeNull();
    expect(deriveNextCard({ ...finished, settled: true })).toBeNull();
  });

  it("needs a completed turn that changed something", () => {
    expect(
      deriveNextCard({ ...finished, latestTurn: { ...finished.latestTurn, state: "error" } }),
    ).toBeNull();
    expect(
      deriveNextCard({
        ...finished,
        latestTurn: { turnId, state: "completed", diffStat: { insertions: 0, deletions: 0 } },
      }),
    ).toBeNull();
    expect(deriveNextCard({ ...finished, latestTurn: { turnId, state: "completed" } })).toBeNull();
  });

  it("counts lines alone until the checkpoint lists its files", () => {
    const state = deriveNextCard({ ...finished, checkpoints: [] });
    expect(formatNextCardChanges(state!)).toBe("+66 −13");
  });
});
