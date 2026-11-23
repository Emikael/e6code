import { describe, expect, it } from "vite-plus/test";

import {
  addedRoundTripMs,
  classifyWsFrames,
  liveTraffic,
  pingAddedMs,
  pingRoundTrips,
  threadEvents,
  threadSubscriptions,
  unaryRoundTrips,
  type WsFrame,
} from "./wsFrames.ts";

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

describe("pingAddedMs", () => {
  it("is the median remote ping minus the median direct one", () => {
    expect(
      pingAddedMs({ direct: [1, 9, 2, 3, 2, 50, 2], remote: [63, 62, 61, 200, 64, 62, 63] }),
    ).toEqual({ addedMs: 61, directMedianMs: 2, remoteMedianMs: 63, throttleVisible: true });
  });

  it("says when the difference is too small for the 60 ms throttle to have applied", () => {
    expect(pingAddedMs({ direct: [2, 2, 3], remote: [20, 22, 21] })).toMatchObject({
      addedMs: 19,
      throttleVisible: false,
    });
  });

  it("has no answer without pings on both sides", () => {
    expect(pingAddedMs({ direct: [], remote: [60] })).toBeNull();
    expect(pingAddedMs({ direct: [2], remote: [] })).toBeNull();
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

const request = (timestampMs: number, id: string, tag: string, socket = "s1"): WsFrame => ({
  ...sent(timestampMs, { _tag: "Request", id, tag, payload: {} }),
  socket,
});
const chunk = (
  timestampMs: number,
  requestId: string,
  values: ReadonlyArray<unknown>,
  socket = "s1",
): WsFrame => ({
  ...received(timestampMs, { _tag: "Chunk", requestId, values }),
  socket,
});
const event = (type: string, payload: Record<string, unknown> = {}) => ({
  kind: "event",
  event: { type, payload },
});

describe("classifyWsFrames", () => {
  it("names each frame's method and tells a subscription's snapshot from its live chunks", () => {
    const frames = [
      request(0, "1", "orchestration.subscribeThread"),
      chunk(10, "1", [{ kind: "snapshot", snapshot: { thread: {} } }]),
      chunk(20, "1", [{ kind: "synchronized" }]),
      chunk(30, "1", [event("thread.message-sent")]),
      {
        ...received(40, { _tag: "Exit", requestId: "1", exit: { _tag: "Success" } }),
        socket: "s1",
      },
    ];
    expect(
      classifyWsFrames(frames).map((frame) => [frame.kind, frame.method, frame.liveValueBytes]),
    ).toEqual([
      ["request", "orchestration.subscribeThread", []],
      ["snapshot", "orchestration.subscribeThread", []],
      // The marker is not an event; the chunk carrying it after a snapshot is live traffic.
      ["live", "orchestration.subscribeThread", []],
      [
        "live",
        "orchestration.subscribeThread",
        [Buffer.byteLength(JSON.stringify(event("thread.message-sent")))],
      ],
      ["exit", "orchestration.subscribeThread", []],
    ]);
  });

  it("counts a resumed subscription's replay before its marker as catch-up, not live", () => {
    const frames = [
      request(0, "4", "orchestration.subscribeShell"),
      chunk(1, "4", [{ kind: "thread-upserted", sequence: 8 }]),
      chunk(2, "4", [
        { kind: "thread-upserted", sequence: 9 },
        { kind: "synchronized" },
        { kind: "thread-upserted", sequence: 10 },
      ]),
      chunk(3, "4", [{ kind: "thread-upserted", sequence: 11 }]),
    ];
    const classified = classifyWsFrames(frames);
    expect(classified.map((frame) => frame.kind)).toEqual([
      "request",
      "catchUp",
      "catchUp",
      "live",
    ]);
    // The marker ends the replay: what follows it in the same chunk is live.
    expect(classified[2]!.liveValueBytes).toEqual([
      Buffer.byteLength(JSON.stringify({ kind: "thread-upserted", sequence: 10 })),
    ]);
  });

  it("treats the first chunk as the snapshot when a stream has neither a snapshot nor a marker", () => {
    const frames = [
      request(0, "2", "server.subscribeConfig"),
      chunk(1, "2", [{ version: 1 }]),
      chunk(2, "2", [{ version: 2 }]),
    ];
    expect(classifyWsFrames(frames).map((frame) => frame.kind)).toEqual([
      "request",
      "snapshot",
      "live",
    ]);
  });

  it("reads frames that carry several messages and keeps request ids apart per socket", () => {
    const frames: Array<WsFrame> = [
      request(0, "1", "orchestration.subscribeThread", "s1"),
      request(0, "1", "orchestration.subscribeShell", "s2"),
      {
        ...received(5, [
          { _tag: "Chunk", requestId: "1", values: [{ kind: "snapshot", snapshot: {} }] },
          { _tag: "Pong" },
        ]),
        socket: "s1",
      },
      chunk(6, "1", [{ kind: "snapshot", snapshot: {} }], "s2"),
      { ...received(7, [{ _tag: "Ping" }]), socket: "s2" },
      { direction: "received", timestampMs: 8, payload: "not json", socket: "s1" },
    ];
    expect(classifyWsFrames(frames).map((frame) => [frame.kind, frame.method])).toEqual([
      ["request", "orchestration.subscribeThread"],
      ["request", "orchestration.subscribeShell"],
      ["snapshot", "orchestration.subscribeThread"],
      ["snapshot", "orchestration.subscribeShell"],
      ["control", null],
      ["other", null],
    ]);
  });

  it("measures bytes as UTF-8, not string length", () => {
    const [frame] = classifyWsFrames([received(0, { _tag: "Pong", note: "é" })]);
    expect(frame!.bytes).toBe(Buffer.byteLength(JSON.stringify({ _tag: "Pong", note: "é" })));
    expect(frame!.bytes).toBeGreaterThan(JSON.stringify({ _tag: "Pong", note: "é" }).length);
  });
});

describe("liveTraffic", () => {
  it("sums live frames and events, received only, over the frames it is given", () => {
    const frames = classifyWsFrames([
      request(0, "1", "orchestration.subscribeThread"),
      chunk(1_000, "1", [{ kind: "snapshot", snapshot: { big: "x".repeat(500) } }]),
      chunk(2_000, "1", [event("thread.message-sent", { text: "a" })]),
      chunk(3_000, "1", [
        event("thread.message-sent", { text: "bb" }),
        event("thread.activity-appended"),
      ]),
      request(3_500, "2", "server.getConfig"),
      {
        ...received(3_600, { _tag: "Exit", requestId: "2", exit: { _tag: "Success" } }),
        socket: "s1",
      },
    ]);
    const traffic = liveTraffic(frames);
    const liveFrames = frames.filter((frame) => frame.kind === "live");
    expect(traffic.liveFrames).toBe(2);
    expect(traffic.liveFrameMaxBytes).toBe(Math.max(...liveFrames.map((frame) => frame.bytes)));
    expect(traffic.liveEvents).toBe(3);
    expect(traffic.liveEventP95Bytes).toBe(
      Math.max(...liveFrames.flatMap((frame) => frame.liveValueBytes)),
    );
    expect(traffic.receivedBytes).toBe(
      frames
        .filter((frame) => frame.direction === "received")
        .reduce((sum, frame) => sum + frame.bytes, 0),
    );
    expect(traffic.byMethod["orchestration.subscribeThread"]).toMatchObject({
      liveFrames: 2,
      snapshotFrames: 1,
    });
  });

  it("is empty without live frames", () => {
    expect(liveTraffic([])).toMatchObject({
      liveFrames: 0,
      liveFrameMaxBytes: null,
      liveEvents: 0,
      liveEventP95Bytes: null,
      receivedBytes: 0,
    });
  });
});

describe("threadEvents", () => {
  it("lists live thread events with their session status, in frame order", () => {
    const frames = classifyWsFrames([
      request(0, "1", "orchestration.subscribeThread"),
      chunk(1, "1", [{ kind: "snapshot", snapshot: {} }]),
      chunk(2, "1", [
        event("thread.session-set", { session: { status: "running" } }),
        event("thread.message-sent"),
      ]),
      chunk(3, "1", [event("thread.session-set", { session: { status: "ready" } })]),
    ]);
    expect(threadEvents(frames)).toEqual([
      { timestampMs: 2, type: "thread.session-set", sessionStatus: "running" },
      { timestampMs: 2, type: "thread.message-sent", sessionStatus: null },
      { timestampMs: 3, type: "thread.session-set", sessionStatus: "ready" },
    ]);
  });
});

describe("threadSubscriptions", () => {
  it("tells a subscription resumed from the client's cache from one that was sent a snapshot", () => {
    const frames: Array<WsFrame> = [
      {
        ...sent(0, {
          _tag: "Request",
          id: "5",
          tag: "orchestration.subscribeThread",
          payload: { threadId: "t-cached", afterSequence: 812, requestCompletionMarker: true },
        }),
        socket: "s1",
      },
      {
        ...sent(1, {
          _tag: "Request",
          id: "6",
          tag: "orchestration.subscribeThread",
          payload: { threadId: "t-fresh" },
        }),
        socket: "s1",
      },
      {
        ...sent(1, { _tag: "Request", id: "7", tag: "server.getConfig", payload: {} }),
        socket: "s1",
      },
      chunk(2, "5", [{ kind: "synchronized" }]),
      chunk(3, "6", [{ kind: "snapshot", snapshot: {} }]),
    ];
    expect(threadSubscriptions(frames)).toEqual([
      { threadId: "t-cached", afterSequence: 812, snapshot: false, synchronized: true },
      { threadId: "t-fresh", afterSequence: null, snapshot: true, synchronized: false },
    ]);
  });
});
