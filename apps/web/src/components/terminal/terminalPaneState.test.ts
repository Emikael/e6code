import { describe, expect, it } from "vite-plus/test";

import {
  findLocalAddress,
  localAddressLabel,
  nextFinishedTerminalIds,
  nextTerminalStopState,
  NO_TERMINAL_STOPS,
  resumeFinishedTerminalState,
} from "./terminalPaneState";

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

describe("the Finished cue across threads", () => {
  it("marks a process that stopped while the user was in another thread", () => {
    const left = { running: ["a", "b"], inView: ["a"], finished: new Set<string>() };
    const resumed = resumeFinishedTerminalState(left, ["b"], ["a"]);
    // "a" was on screen when the user left, but it stopped while they were away.
    expect([...resumed.finished]).toEqual(["a"]);
    expect(resumed.inView).toEqual(["a"]);
  });

  it("drops a cue that was on screen when the user left", () => {
    const left = { running: [], inView: ["a"], finished: new Set(["a", "b"]) };
    expect([...resumeFinishedTerminalState(left, [], []).finished]).toEqual(["b"]);
  });

  it("starts empty for a thread it has not seen", () => {
    expect(resumeFinishedTerminalState(undefined, ["a"], []).finished.size).toBe(0);
  });
});

describe("Stop on a process that ignores Ctrl-C", () => {
  const sent = nextTerminalStopState(NO_TERMINAL_STOPS, { type: "stop-sent", terminalId: "a" });

  it("says nothing when the process stops", () => {
    const stopped = nextTerminalStopState(sent, { type: "running-changed", running: new Set() });
    const late = nextTerminalStopState(stopped, { type: "grace-elapsed", terminalId: "a" });
    expect(late.ignored.size).toBe(0);
    expect(late.pending.size).toBe(0);
  });

  it("says the process is still running once the grace period passes", () => {
    const elapsed = nextTerminalStopState(sent, { type: "grace-elapsed", terminalId: "a" });
    expect(elapsed.ignored.has("a")).toBe(true);
    const stillRunning = nextTerminalStopState(elapsed, {
      type: "running-changed",
      running: new Set(["a"]),
    });
    expect(stillRunning).toBe(elapsed);
    const stopped = nextTerminalStopState(elapsed, {
      type: "running-changed",
      running: new Set(),
    });
    expect(stopped.ignored.has("a")).toBe(false);
  });

  it("ignores a grace period for a pane that was not stopped", () => {
    expect(
      nextTerminalStopState(NO_TERMINAL_STOPS, { type: "grace-elapsed", terminalId: "a" }),
    ).toBe(NO_TERMINAL_STOPS);
  });
});
