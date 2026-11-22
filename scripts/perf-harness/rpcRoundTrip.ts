/**
 * Round trips of unary RPC requests read from WebSocket frames the browser
 * captured over CDP. The client speaks Effect RPC JSON: a `Request` carries
 * `id` and `tag`, a unary answer is one `Exit` with that `requestId`, and a
 * stream answers with `Chunk` messages first. A frame may hold one message or
 * an array of them.
 *
 * Used for `addedRpcRoundTripMs`, the in-app check that the throttle proxy
 * delays WebSocket traffic as much as it should. The client pings every 5 s
 * and the server answers with no work of its own, so ping round trips on an
 * idle page are the clean measure; unary requests carry server time.
 *
 * @module perf-harness/rpcRoundTrip
 */
import { percentile } from "./stats.ts";

export interface WsFrame {
  /** The socket the frame travelled on; request ids are only unique within one. */
  readonly socket?: string;
  readonly direction: "sent" | "received";
  readonly timestampMs: number;
  readonly payload: string;
}

const messagesOf = (payload: string): Array<Record<string, unknown>> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.filter(
    (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
  );
};

/** Each unary request that got its `Exit`, with the method tag and round trip in ms. */
export function unaryRoundTrips(
  frames: ReadonlyArray<WsFrame>,
): Array<{ readonly tag: string; readonly ms: number }> {
  const requests = new Map<string, { tag: string; sentAt: number; streamed: boolean }>();
  const trips: Array<{ tag: string; ms: number }> = [];
  for (const frame of frames) {
    for (const message of messagesOf(frame.payload)) {
      if (frame.direction === "sent") {
        if (message._tag === "Request" && typeof message.tag === "string") {
          requests.set(`${frame.socket ?? ""}:${String(message.id)}`, {
            tag: message.tag,
            sentAt: frame.timestampMs,
            streamed: false,
          });
        }
        continue;
      }
      const key = `${frame.socket ?? ""}:${String(message.requestId)}`;
      const request = requests.get(key);
      if (request === undefined) continue;
      if (message._tag === "Chunk") request.streamed = true;
      if (message._tag === "Exit") {
        requests.delete(key);
        if (!request.streamed)
          trips.push({ tag: request.tag, ms: frame.timestampMs - request.sentAt });
      }
    }
  }
  return trips;
}

/** Round trips of the RPC client's `Ping`s, each paired with the next `Pong` on its socket. */
export function pingRoundTrips(frames: ReadonlyArray<WsFrame>): Array<number> {
  const pending = new Map<string, Array<number>>();
  const trips: Array<number> = [];
  for (const frame of frames) {
    const socket = frame.socket ?? "";
    for (const message of messagesOf(frame.payload)) {
      if (frame.direction === "sent" && message._tag === "Ping") {
        pending.set(socket, [...(pending.get(socket) ?? []), frame.timestampMs]);
      } else if (frame.direction === "received" && message._tag === "Pong") {
        const sentAt = pending.get(socket)?.shift();
        if (sentAt !== undefined) trips.push(frame.timestampMs - sentAt);
      }
    }
  }
  return trips;
}

/**
 * How much slower unary RPCs were in `remote` than in `direct`: per method,
 * the fastest round trip each way, then the median difference over methods
 * seen in both. Fastest-per-method keeps server work out of the comparison.
 */
export function addedRoundTripMs(
  direct: ReadonlyArray<{ readonly tag: string; readonly ms: number }>,
  remote: ReadonlyArray<{ readonly tag: string; readonly ms: number }>,
): {
  readonly addedMs: number;
  readonly methods: number;
  readonly perMethod: ReadonlyArray<{
    readonly tag: string;
    readonly directMs: number;
    readonly remoteMs: number;
  }>;
} | null {
  const fastest = (trips: ReadonlyArray<{ readonly tag: string; readonly ms: number }>) => {
    const byTag = new Map<string, number>();
    for (const trip of trips) {
      byTag.set(trip.tag, Math.min(byTag.get(trip.tag) ?? Infinity, trip.ms));
    }
    return byTag;
  };
  const directFastest = fastest(direct);
  const perMethod: Array<{ tag: string; directMs: number; remoteMs: number }> = [];
  for (const [tag, remoteMs] of fastest(remote)) {
    const directMs = directFastest.get(tag);
    if (directMs !== undefined) perMethod.push({ tag, directMs, remoteMs });
  }
  const median = percentile(
    perMethod.map((entry) => entry.remoteMs - entry.directMs),
    0.5,
  );
  return median === null
    ? null
    : {
        addedMs: median,
        methods: perMethod.length,
        perMethod: perMethod.toSorted((left, right) => left.tag.localeCompare(right.tag)),
      };
}
