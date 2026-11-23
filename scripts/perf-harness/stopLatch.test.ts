// @effect-diagnostics nodeBuiltinImport:off - stands in for the process's signal and crash events.
import * as NodeEvents from "node:events";

import { describe, expect, it } from "vite-plus/test";

import { HarnessStoppedError, StopLatch, trapStops } from "./stopLatch.ts";

describe("StopLatch", () => {
  it("records the first stop only and refuses new work after it", () => {
    const latch = new StopLatch();
    expect(() => latch.check("server")).not.toThrow();
    expect(latch.request("SIGINT")).toBe(true);
    expect(latch.request("SIGTERM")).toBe(false);
    expect(latch.stopped).toBe(true);
    expect(() => latch.check("server")).toThrow(HarnessStoppedError);
    expect(() => latch.check("server")).toThrow(/SIGINT.*server/);
  });

  it("starts nothing once stopped", async () => {
    const latch = new StopLatch();
    latch.request("SIGTERM");
    let started = false;
    await expect(
      latch.start(
        "browser",
        async () => {
          started = true;
          return "browser";
        },
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(HarnessStoppedError);
    expect(started).toBe(false);
  });

  it("disposes what finished starting after the stop, and hands back what started before it", async () => {
    const latch = new StopLatch();
    const disposed: Array<string> = [];
    const dispose = async (value: string) => {
      disposed.push(value);
    };

    expect(await latch.start("sink", async () => "sink", dispose)).toBe("sink");

    let release: (value: string) => void = () => undefined;
    const starting = latch.start(
      "server",
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
      dispose,
    );
    latch.request("SIGINT");
    release("server pid 42");
    await expect(starting).rejects.toBeInstanceOf(HarnessStoppedError);
    expect(disposed).toEqual(["server pid 42"]);
  });
});

describe("trapStops", () => {
  const trap = (teardown: () => Promise<void> = async () => undefined) => {
    const latch = new StopLatch();
    const events = new NodeEvents.EventEmitter();
    const logged: Array<string> = [];
    let teardowns = 0;
    let latchSetBeforeTeardown = false;
    const exits: Array<number> = [];
    const exited = new Promise<number>((resolve) => {
      trapStops({
        latch,
        events,
        log: (message) => logged.push(message),
        describeError: (error) => (error instanceof Error ? error.message : String(error)),
        teardown: () => {
          teardowns += 1;
          latchSetBeforeTeardown = latch.stopped;
          return teardown();
        },
        exit: (code) => {
          exits.push(code);
          resolve(code);
        },
      });
    });
    return {
      latch,
      events,
      logged,
      exited,
      exits,
      teardowns: () => teardowns,
      latchSetBeforeTeardown: () => latchSetBeforeTeardown,
    };
  };

  it("tears down once and exits 128 plus the signal number for SIGINT, SIGTERM and SIGHUP", async () => {
    for (const [signal, code] of [
      ["SIGINT", 130],
      ["SIGTERM", 143],
      ["SIGHUP", 129],
    ] as const) {
      const run = trap();
      run.events.emit(signal, signal);
      expect(run.latch.stopped, signal).toBe(true);
      run.events.emit("SIGTERM", "SIGTERM");
      expect(await run.exited, signal).toBe(code);
      expect(run.teardowns(), signal).toBe(1);
      expect(run.latchSetBeforeTeardown(), signal).toBe(true);
    }
  });

  it("tears down and exits 1 after an uncaught exception or an unhandled rejection", async () => {
    const thrown = trap();
    thrown.events.emit("uncaughtException", new Error("boom"));
    expect(thrown.latch.stopped).toBe(true);
    expect(await thrown.exited).toBe(1);
    expect(thrown.teardowns()).toBe(1);
    expect(thrown.logged.join("\n")).toContain("boom");

    const rejected = trap();
    rejected.events.emit("unhandledRejection", "not an error", Promise.resolve());
    expect(await rejected.exited).toBe(1);
    expect(rejected.teardowns()).toBe(1);
  });

  it("does not start a second teardown for a crash during one, and still exits once", async () => {
    let release: () => void = () => undefined;
    const run = trap(() => new Promise<void>((resolve) => (release = resolve)));
    run.events.emit("SIGHUP", "SIGHUP");
    run.events.emit("uncaughtException", new Error("while stopping"));
    release();
    expect(await run.exited).toBe(129);
    expect(run.teardowns()).toBe(1);
    expect(run.exits).toEqual([129]);
  });

  it("exits even when the teardown fails", async () => {
    const run = trap(async () => {
      throw new Error("stop failed");
    });
    run.events.emit("SIGTERM", "SIGTERM");
    expect(await run.exited).toBe(143);
    expect(run.logged.join("\n")).toContain("stop failed");
  });
});
