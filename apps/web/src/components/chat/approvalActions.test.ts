import { describe, expect, it } from "vite-plus/test";

import { approvalMoreLabel } from "./approvalActions";

describe("approvalMoreLabel", () => {
  it("names what More holds", () => {
    expect(
      approvalMoreLabel(
        [{ decision: "acceptForSession", label: "Always allow this session" }],
        true,
      ),
    ).toBe("More: always allow this session, decline with a message");
    expect(approvalMoreLabel([], false)).toBe("More");
  });
});
