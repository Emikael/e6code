import { describe, expect, it } from "vite-plus/test";

import { addedRoundTripMs, pingRoundTrips, unaryRoundTrips, type WsFrame } from "./rpcRoundTrip.ts";

const sent = (timestampMs: number, payload: unknown): WsFrame => ({
  direction: "sent",
  timestampMs,
  payload: JSON.stringify(payload),
});
const received = (timestampMs: number, payload: unknown): WsFrame => ({
  direction: "received",
  timestampMs,
  payload: JSON.stringify(payload),
});

describe("unaryRoundTrips", () => {
  it("times a request to its exit", () => {
    const frames = [
      sent(100, { _tag: "Request", id: "1", tag: "server.getConfig", payload: {} }),
      received(105.5, { _tag: "Exit", requestId: "1", exit: { _tag: "Success" } }),
    ];
    expect(unaryRoundTrips(frames)).toEqual([{ tag: "server.getConfig", ms: 5.5 }]);
  });

  it("leaves out streams, which answer with chunks before their exit", () => {
    const frames = [
      sent(0, { _tag: "Request", id: "7", tag: "subscribeShell", payload: {} }),
      received(10, { _tag: "Chunk", requestId: "7", values: [{}] }),
      received(20, { _tag: "Exit", requestId: "7", exit: { _tag: "Success" } }),
    ];
    expect(unaryRoundTrips(frames)).toEqual([]);
  });

  it("reads frames that carry several messages and skips anything else", () => {
    const frames: Array<WsFrame> = [
      sent(0, [
        { _tag: "Request", id: "1", tag: "a.one", payload: {} },
        { _tag: "Request", id: "2", tag: "a.two", payload: {} },
      ]),
      { direction: "received", timestampMs: 1, payload: "not json" },
      received(2, { _tag: "Pong" }),
      received(4, [
        { _tag: "Exit", requestId: "2", exit: {} },
        { _tag: "Exit", requestId: "1", exit: {} },
      ]),
      received(9, { _tag: "Exit", requestId: "99", exit: {} }),
    ];
    expect(unaryRoundTrips(frames)).toEqual([
      { tag: "a.two", ms: 4 },
      { tag: "a.one", ms: 4 },
    ]);
  });

  it("keeps request ids apart per socket, since every connection counts from zero", () => {
    const frames: Array<WsFrame> = [
      { ...sent(0, { _tag: "Request", id: "1", tag: "a", payload: {} }), socket: "s1" },
      { ...sent(50, { _tag: "Request", id: "1", tag: "b", payload: {} }), socket: "s2" },
      { ...received(70, { _tag: "Exit", requestId: "1", exit: {} }), socket: "s2" },
      { ...received(90, { _tag: "Exit", requestId: "1", exit: {} }), socket: "s1" },
    ];
    expect(unaryRoundTrips(frames)).toEqual([
      { tag: "b", ms: 20 },
      { tag: "a", ms: 90 },
    ]);
  });
});

describe("pingRoundTrips", () => {
  it("pairs each ping with the next pong on the same socket", () => {
    const frames: Array<WsFrame> = [
      { ...sent(0, { _tag: "Ping" }), socket: "s1" },
      { ...sent(10, { _tag: "Ping" }), socket: "s2" },
      { ...received(61, { _tag: "Pong" }), socket: "s1" },
      { ...sent(5_000, { _tag: "Ping" }), socket: "s1" },
      { ...received(5_062, { _tag: "Pong" }), socket: "s1" },
      { ...received(5_100, { _tag: "Pong" }), socket: "s3" },
    ];
    expect(pingRoundTrips(frames)).toEqual([61, 62]);
  });
});

describe("addedRoundTripMs", () => {
  it("compares each method's fastest round trip and takes the median difference", () => {
    const direct = [
      { tag: "a", ms: 3 },
      { tag: "a", ms: 2 },
      { tag: "b", ms: 5 },
      { tag: "c", ms: 1 },
      { tag: "only-direct", ms: 1 },
    ];
    const remote = [
      { tag: "a", ms: 64 },
      { tag: "a", ms: 62 },
      { tag: "b", ms: 70 },
      { tag: "c", ms: 59 },
      { tag: "only-remote", ms: 500 },
    ];
    expect(addedRoundTripMs(direct, remote)).toEqual({
      addedMs: 60,
      methods: 3,
      perMethod: [
        { tag: "a", directMs: 2, remoteMs: 62 },
        { tag: "b", directMs: 5, remoteMs: 70 },
        { tag: "c", directMs: 1, remoteMs: 59 },
      ],
    });
  });

  it("has no value without a method seen both ways", () => {
    expect(addedRoundTripMs([{ tag: "a", ms: 1 }], [{ tag: "b", ms: 2 }])).toBeNull();
  });
});
