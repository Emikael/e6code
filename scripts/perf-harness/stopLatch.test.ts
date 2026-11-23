import { describe, expect, it } from "vite-plus/test";

import { HarnessStoppedError, StopLatch } from "./stopLatch.ts";

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
