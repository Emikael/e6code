import * as Layer from "effect/Layer";
import { RpcSerialization } from "effect/unstable/rpc";

import type { RpcFrameKind } from "./PerformanceAggregates.ts";

/** Requests whose tag is not a known RPC method; keeps a bad client from adding names. */
export const UNKNOWN_METHOD = "(unknown)";
/** Frames that answer no request: pongs, defects and protocol errors. */
export const PROTOCOL_FRAMES = "(protocol)";
/** A leak guard: requests beyond this many in flight are counted as unknown. */
const MAX_IN_FLIGHT_REQUESTS = 4_096;

export type RecordFrame = (
  method: string,
  kind: RpcFrameKind,
  bytes: number,
  values: number,
) => void;

interface EncodedMessage {
  readonly _tag?: unknown;
  readonly id?: unknown;
  readonly tag?: unknown;
  readonly requestId?: unknown;
  readonly values?: ReadonlyArray<unknown>;
  readonly isNotification?: unknown;
}

/**
 * JSON RPC serialization that also counts the encoded bytes of every outgoing
 * frame per RPC method. It measures the string `RpcSerialization.json` already
 * produced, so it adds no serialization work and the frames stay identical.
 *
 * The RPC server makes one parser per WebSocket, so each parser maps its own
 * request ids to methods: learned when a `Request` is decoded, forgotten when
 * its `Exit` is encoded. The server still sends an `Exit` after a client
 * interrupt, so the entry must outlive the `Interrupt`.
 */
export function makeMeasuredJsonSerialization(options: {
  readonly methods: ReadonlySet<string>;
  readonly recordFrame: RecordFrame;
}): RpcSerialization.RpcSerialization["Service"] {
  const json = RpcSerialization.json;
  return RpcSerialization.RpcSerialization.of({
    contentType: json.contentType,
    includesFraming: json.includesFraming,
    codecFor: json.codecFor,
    makeUnsafe: () => {
      const parser = json.makeUnsafe();
      const methodByRequestId = new Map<string, string>();

      const methodFor = (requestId: unknown, isExit: boolean): string => {
        const key = String(requestId);
        const method = methodByRequestId.get(key) ?? UNKNOWN_METHOD;
        if (isExit) methodByRequestId.delete(key);
        return method;
      };

      return {
        decode: (data) => {
          const messages = parser.decode(data);
          for (const message of messages as ReadonlyArray<EncodedMessage>) {
            if (message._tag !== "Request" || message.isNotification === true) continue;
            if (methodByRequestId.size >= MAX_IN_FLIGHT_REQUESTS) continue;
            const tag = typeof message.tag === "string" ? message.tag : "";
            methodByRequestId.set(
              String(message.id),
              options.methods.has(tag) ? tag : UNKNOWN_METHOD,
            );
          }
          return messages;
        },
        encode: (response) => {
          const encoded = parser.encode(response);
          if (encoded === undefined) return encoded;
          const bytes =
            typeof encoded === "string" ? Buffer.byteLength(encoded) : encoded.byteLength;
          const message = response as EncodedMessage;
          if (message._tag === "Chunk") {
            options.recordFrame(
              methodFor(message.requestId, false),
              "chunk",
              bytes,
              message.values?.length ?? 0,
            );
          } else if (message._tag === "Exit") {
            options.recordFrame(methodFor(message.requestId, true), "exit", bytes, 0);
          } else {
            options.recordFrame(PROTOCOL_FRAMES, "exit", bytes, 0);
          }
          return encoded;
        },
      };
    },
  });
}

export const layer = (options: Parameters<typeof makeMeasuredJsonSerialization>[0]) =>
  Layer.succeed(RpcSerialization.RpcSerialization, makeMeasuredJsonSerialization(options));
