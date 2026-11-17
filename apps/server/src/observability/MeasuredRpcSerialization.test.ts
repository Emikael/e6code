import { RpcSerialization } from "effect/unstable/rpc";
import { describe, expect, it } from "vite-plus/test";

import {
  PROTOCOL_FRAMES,
  UNKNOWN_METHOD,
  makeMeasuredJsonSerialization,
} from "./MeasuredRpcSerialization.ts";

interface Frame {
  readonly method: string;
  readonly kind: string;
  readonly bytes: number;
  readonly values: number;
}

function setup() {
  const frames: Array<Frame> = [];
  const serialization = makeMeasuredJsonSerialization({
    methods: new Set(["orchestration.subscribeThread", "server.getConfig"]),
    recordFrame: (method, kind, bytes, values) => frames.push({ method, kind, bytes, values }),
  });
  return { frames, parser: serialization.makeUnsafe() };
}

const request = (id: string, tag: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ _tag: "Request", id, tag, payload: {}, headers: [], ...extra });

describe("makeMeasuredJsonSerialization", () => {
  it("produces exactly the frames RpcSerialization.json produces", () => {
    const { parser } = setup();
    const plain = RpcSerialization.json.makeUnsafe();
    const chunk = { _tag: "Chunk", requestId: "1", values: [{ text: "héllo ✓" }] };
    expect(parser.encode(chunk)).toBe(plain.encode(chunk));
    expect(parser.decode(request("1", "server.getConfig"))).toEqual(
      plain.decode(request("1", "server.getConfig")),
    );
  });

  it("attributes stream chunks and the final exit to the request's method", () => {
    const { frames, parser } = setup();
    parser.decode(request("7", "orchestration.subscribeThread"));
    const chunk = parser.encode({ _tag: "Chunk", requestId: "7", values: [{ a: "é" }, { b: 1 }] });
    parser.encode({ _tag: "Exit", requestId: "7", exit: { _tag: "Success", value: null } });

    expect(frames[0]).toEqual({
      method: "orchestration.subscribeThread",
      kind: "chunk",
      bytes: Buffer.byteLength(chunk as string),
      values: 2,
    });
    expect(frames[1]).toMatchObject({ method: "orchestration.subscribeThread", kind: "exit" });
    // UTF-8 bytes, not string length.
    expect(frames[0]!.bytes).toBe((chunk as string).length + 1);
  });

  it("still attributes the exit sent after a client interrupt, then forgets the request", () => {
    const { frames, parser } = setup();
    parser.decode(request("9", "orchestration.subscribeThread"));
    parser.decode(JSON.stringify({ _tag: "Interrupt", requestId: "9" }));
    parser.encode({ _tag: "Exit", requestId: "9", exit: { _tag: "Failure", cause: [] } });
    parser.encode({ _tag: "Chunk", requestId: "9", values: [1] });

    expect(frames.map((frame) => frame.method)).toEqual([
      "orchestration.subscribeThread",
      UNKNOWN_METHOD,
    ]);
  });

  it("maps unknown tags to one bucket and does not track notifications", () => {
    const { frames, parser } = setup();
    parser.decode(request("1", "not.a.method"));
    parser.decode(request("2", "server.getConfig", { isNotification: true }));
    parser.encode({ _tag: "Exit", requestId: "1", exit: { _tag: "Success", value: 1 } });
    parser.encode({ _tag: "Exit", requestId: "2", exit: { _tag: "Success", value: 1 } });

    expect(frames.map((frame) => frame.method)).toEqual([UNKNOWN_METHOD, UNKNOWN_METHOD]);
  });

  it("counts frames that answer no request as protocol frames", () => {
    const { frames, parser } = setup();
    parser.encode({ _tag: "Pong" });
    parser.encode({ _tag: "Defect", defect: "boom" });

    expect(frames.map((frame) => [frame.method, frame.kind])).toEqual([
      [PROTOCOL_FRAMES, "exit"],
      [PROTOCOL_FRAMES, "exit"],
    ]);
  });

  it("keeps request ids separate per connection", () => {
    const { frames, parser: first } = setup();
    const serialization = makeMeasuredJsonSerialization({
      methods: new Set(["server.getConfig"]),
      recordFrame: (method, kind, bytes, values) => frames.push({ method, kind, bytes, values }),
    });
    const second = serialization.makeUnsafe();
    first.decode(request("1", "server.getConfig"));
    second.encode({ _tag: "Exit", requestId: "1", exit: { _tag: "Success", value: 1 } });

    expect(frames[0]?.method).toBe(UNKNOWN_METHOD);
  });
});
