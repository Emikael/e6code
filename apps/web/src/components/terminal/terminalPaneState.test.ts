import { describe, expect, it } from "vite-plus/test";

import { findLocalAddress, localAddressLabel, nextFinishedTerminalIds } from "./terminalPaneState";

describe("local addresses in terminal output", () => {
  it("finds the last local address a dev server printed", () => {
    const output = [
      "[dev-runner] server  http://localhost:5734",
      "  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5733\u001b[22m/\u001b[39m",
      "  ➜  Network: http://192.168.1.4:5733/",
    ].join("\r\n");
    expect(findLocalAddress(output)).toBe("http://localhost:5733/");
  });

  it("reads 0.0.0.0 as localhost and drops sentence punctuation", () => {
    expect(findLocalAddress("Listening on http://0.0.0.0:8080.")).toBe("http://localhost:8080");
    expect(findLocalAddress("see (http://127.0.0.1:3000/docs)")).toBe("http://127.0.0.1:3000/docs");
  });

  it("ignores addresses that are not local", () => {
    expect(findLocalAddress("fetching https://registry.npmjs.org/react")).toBeNull();
    expect(findLocalAddress("http://localhost.example.com")).toBeNull();
  });

  it("labels an address without its scheme", () => {
    expect(localAddressLabel("http://localhost:5733/")).toBe("localhost:5733");
    expect(localAddressLabel("http://localhost:5733/settings")).toBe("localhost:5733/settings");
  });
});

describe("the Finished cue", () => {
  const empty: ReadonlySet<string> = new Set();

  it("marks a process that stopped out of view, not one stopped in view", () => {
    expect([
      ...nextFinishedTerminalIds({
        finished: empty,
        previousRunning: ["a", "b"],
        running: [],
        previousInView: ["b"],
        inView: ["b"],
      }),
    ]).toEqual(["a"]);
  });

  it("keeps the cue while the pane is looked at, and drops it once left or run again", () => {
    const finished: ReadonlySet<string> = new Set(["a"]);
    const looking = nextFinishedTerminalIds({
      finished,
      previousRunning: [],
      running: [],
      previousInView: [],
      inView: ["a"],
    });
    expect(looking).toBe(finished);
    expect(
      nextFinishedTerminalIds({
        finished,
        previousRunning: [],
        running: [],
        previousInView: ["a"],
        inView: [],
      }).size,
    ).toBe(0);
    expect(
      nextFinishedTerminalIds({
        finished,
        previousRunning: [],
        running: ["a"],
        previousInView: [],
        inView: [],
      }).size,
    ).toBe(0);
  });
});
