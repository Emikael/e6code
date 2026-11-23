/**
 * WebSocket frames the browser captured over CDP, read as Effect RPC JSON: a
 * `Request` carries `id` and `tag`, a stream answers with `Chunk` messages
 * (`requestId`, `values`) and every call ends with one `Exit`. A frame may
 * hold one message or an array of them, and request ids are only unique per
 * socket. Bytes are the UTF-8 payload the page saw, which is before
 * permessage-deflate compression.
 *
 * A subscription's chunks are classified by what they carry (plan §4.3, Q5):
 * a chunk with a `snapshot` value is the snapshot and everything after it is
 * live; a resumed subscription replays events until its `synchronized`
 * marker, which is catch-up, and is live after it. A stream that shows
 * neither has its first chunk counted as the snapshot. Markers are not events.
 *
 * Round trips: the server answers a `Ping` with no work of its own, so pings
 * from an idle page (the client's every 5 s, or the harness's probe) are the
 * clean measure of what the throttle proxy adds (`addedRpcRoundTripMs`);
 * unary requests carry server time.
 *
 * @module perf-harness/wsFrames
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

export type FrameKind = "request" | "snapshot" | "catchUp" | "live" | "exit" | "control" | "other";

export interface ClassifiedFrame extends WsFrame {
  readonly kind: FrameKind;
  /** The RPC method of the request the frame belongs to, when it names one. */
  readonly method: string | null;
  readonly bytes: number;
  /** UTF-8 bytes of each live event value the frame carries. */
  readonly liveValueBytes: ReadonlyArray<number>;
  readonly liveValues: ReadonlyArray<Record<string, unknown>>;
}

const KIND_RANK: Record<FrameKind, number> = {
  snapshot: 6,
  catchUp: 5,
  live: 4,
  exit: 3,
  request: 2,
  control: 1,
  other: 0,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const valueTag = (value: unknown) =>
  isRecord(value) ? (typeof value.kind === "string" ? value.kind : value.type) : undefined;
const isSnapshotValue = (value: unknown) => valueTag(value) === "snapshot";
const isMarkerValue = (value: unknown) => isRecord(value) && value.kind === "synchronized";
const chunkValues = (message: Record<string, unknown>): ReadonlyArray<unknown> =>
  Array.isArray(message.values) ? message.values : [];

/** Every frame with its kind, method, byte size and live event values, in capture order. */
export function classifyWsFrames(frames: ReadonlyArray<WsFrame>): Array<ClassifiedFrame> {
  const parsed = frames.map((frame) => ({ frame, messages: messagesOf(frame.payload) }));
  const subscriptionShape = new Map<string, { snapshot: boolean; marker: boolean }>();
  for (const { frame, messages } of parsed) {
    if (frame.direction !== "received") continue;
    for (const message of messages) {
      if (message._tag !== "Chunk") continue;
      const key = `${frame.socket ?? ""}:${String(message.requestId)}`;
      const shape = subscriptionShape.get(key) ?? { snapshot: false, marker: false };
      const values = chunkValues(message);
      shape.snapshot ||= values.some(isSnapshotValue);
      shape.marker ||= values.some(isMarkerValue);
      subscriptionShape.set(key, shape);
    }
  }
  const methods = new Map<string, string>();
  const phase = new Map<string, "start" | "replay" | "live">();
  return parsed.map(({ frame, messages }): ClassifiedFrame => {
    let kind: FrameKind = "other";
    let method: string | null = null;
    const liveValues: Array<Record<string, unknown>> = [];
    const rank = (next: FrameKind) => {
      if (KIND_RANK[next] > KIND_RANK[kind]) kind = next;
    };
    for (const message of messages) {
      const tag = message._tag;
      if (tag === "Ping" || tag === "Pong") {
        rank("control");
        continue;
      }
      if (frame.direction === "sent") {
        if (tag === "Request" && typeof message.tag === "string") {
          methods.set(`${frame.socket ?? ""}:${String(message.id)}`, message.tag);
          method ??= message.tag;
          rank("request");
        }
        continue;
      }
      const key = `${frame.socket ?? ""}:${String(message.requestId)}`;
      method ??= methods.get(key) ?? null;
      if (tag === "Exit") {
        rank("exit");
        continue;
      }
      if (tag !== "Chunk") continue;
      const values = chunkValues(message);
      const current = phase.get(key) ?? "start";
      const shape = subscriptionShape.get(key) ?? { snapshot: false, marker: false };
      if (values.some(isSnapshotValue)) {
        rank("snapshot");
        phase.set(key, "live");
        continue;
      }
      if (current === "live") {
        rank("live");
        for (const value of values) {
          if (isRecord(value) && !isMarkerValue(value)) liveValues.push(value);
        }
        continue;
      }
      const markerAt = values.findIndex(isMarkerValue);
      if (markerAt !== -1) {
        rank("catchUp");
        phase.set(key, "live");
        for (const value of values.slice(markerAt + 1)) {
          if (isRecord(value) && !isMarkerValue(value)) liveValues.push(value);
        }
        continue;
      }
      if (current === "start" && !shape.snapshot && !shape.marker) {
        rank("snapshot");
        phase.set(key, "live");
        continue;
      }
      rank("catchUp");
      phase.set(key, "replay");
    }
    return {
      ...frame,
      kind,
      method,
      bytes: Buffer.byteLength(frame.payload, "utf8"),
      liveValues,
      liveValueBytes: liveValues.map((value) => Buffer.byteLength(JSON.stringify(value), "utf8")),
    };
  });
}

interface MethodTraffic {
  liveFrames: number;
  snapshotFrames: number;
  catchUpFrames: number;
  receivedBytes: number;
  liveFrameMaxBytes: number;
  snapshotMaxBytes: number;
}

/**
 * Received traffic in `frames`: live frames and their largest size, live
 * events and their p95 size, all received bytes, and the same per method.
 */
export function liveTraffic(frames: ReadonlyArray<ClassifiedFrame>): {
  readonly liveFrames: number;
  readonly liveFrameMaxBytes: number | null;
  readonly liveEvents: number;
  readonly liveEventP95Bytes: number | null;
  readonly liveEventMaxBytes: number | null;
  readonly receivedBytes: number;
  readonly receivedFrames: number;
  readonly byMethod: Record<string, MethodTraffic>;
} {
  const byMethod: Record<string, MethodTraffic> = {};
  const eventBytes: Array<number> = [];
  let liveFrames = 0;
  let liveFrameMaxBytes: number | null = null;
  let receivedBytes = 0;
  let receivedFrames = 0;
  for (const frame of frames) {
    if (frame.direction !== "received") continue;
    receivedBytes += frame.bytes;
    receivedFrames += 1;
    eventBytes.push(...frame.liveValueBytes);
    const entry = (byMethod[frame.method ?? "(none)"] ??= {
      liveFrames: 0,
      snapshotFrames: 0,
      catchUpFrames: 0,
      receivedBytes: 0,
      liveFrameMaxBytes: 0,
      snapshotMaxBytes: 0,
    });
    entry.receivedBytes += frame.bytes;
    if (frame.kind === "live") {
      liveFrames += 1;
      liveFrameMaxBytes = Math.max(liveFrameMaxBytes ?? 0, frame.bytes);
      entry.liveFrames += 1;
      entry.liveFrameMaxBytes = Math.max(entry.liveFrameMaxBytes, frame.bytes);
    } else if (frame.kind === "snapshot") {
      entry.snapshotFrames += 1;
      entry.snapshotMaxBytes = Math.max(entry.snapshotMaxBytes, frame.bytes);
    } else if (frame.kind === "catchUp") {
      entry.catchUpFrames += 1;
    }
  }
  return {
    liveFrames,
    liveFrameMaxBytes,
    liveEvents: eventBytes.length,
    liveEventP95Bytes: percentile(eventBytes, 0.95),
    liveEventMaxBytes: eventBytes.length === 0 ? null : Math.max(...eventBytes),
    receivedBytes,
    receivedFrames,
    byMethod,
  };
}

/** Live orchestration events the frames carry, with the session status a session event set. */
export function threadEvents(frames: ReadonlyArray<ClassifiedFrame>): Array<{
  readonly timestampMs: number;
  readonly type: string;
  readonly sessionStatus: string | null;
}> {
  const events: Array<{ timestampMs: number; type: string; sessionStatus: string | null }> = [];
  for (const frame of frames) {
    for (const value of frame.liveValues) {
      if (value.kind !== "event" || !isRecord(value.event)) continue;
      const type = value.event.type;
      if (typeof type !== "string") continue;
      const payload = isRecord(value.event.payload) ? value.event.payload : undefined;
      const session = isRecord(payload?.session) ? payload.session : undefined;
      events.push({
        timestampMs: frame.timestampMs,
        type,
        sessionStatus: typeof session?.status === "string" ? session.status : null,
      });
    }
  }
  return events;
}

/**
 * Each `orchestration.subscribeThread` request in `frames`: its thread, the
 * `afterSequence` it resumed from (the client sends one only when it holds the
 * thread in its cache) and whether the server answered with a snapshot or
 * reached its `synchronized` marker within `frames`.
 */
export function threadSubscriptions(frames: ReadonlyArray<WsFrame>): Array<{
  readonly threadId: string | null;
  readonly afterSequence: number | null;
  readonly snapshot: boolean;
  readonly synchronized: boolean;
}> {
  const byRequest = new Map<
    string,
    {
      threadId: string | null;
      afterSequence: number | null;
      snapshot: boolean;
      synchronized: boolean;
    }
  >();
  for (const frame of frames) {
    for (const message of messagesOf(frame.payload)) {
      const key = `${frame.socket ?? ""}:${String(frame.direction === "sent" ? message.id : message.requestId)}`;
      if (frame.direction === "sent") {
        if (message._tag !== "Request" || message.tag !== "orchestration.subscribeThread") continue;
        const payload = isRecord(message.payload) ? message.payload : {};
        byRequest.set(key, {
          threadId: typeof payload.threadId === "string" ? payload.threadId : null,
          afterSequence: typeof payload.afterSequence === "number" ? payload.afterSequence : null,
          snapshot: false,
          synchronized: false,
        });
        continue;
      }
      const subscription = byRequest.get(key);
      if (subscription === undefined || message._tag !== "Chunk") continue;
      const values = chunkValues(message);
      subscription.snapshot ||= values.some(isSnapshotValue);
      subscription.synchronized ||= values.some(isMarkerValue);
    }
  }
  return [...byRequest.values()];
}

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

/** Below this, the remote profile's 60 ms round trip cannot have applied to the pings. */
export const THROTTLE_VISIBLE_MS = 40;

/**
 * What the throttle proxy added to an RPC round trip: the median ping through
 * it minus the median ping direct. `throttleVisible` is false when that is
 * under 40 ms, too little for the 60 ms profile to have applied.
 */
export function pingAddedMs(input: {
  readonly direct: ReadonlyArray<number>;
  readonly remote: ReadonlyArray<number>;
}): {
  readonly addedMs: number;
  readonly directMedianMs: number;
  readonly remoteMedianMs: number;
  readonly throttleVisible: boolean;
} | null {
  const directMedianMs = percentile(input.direct, 0.5);
  const remoteMedianMs = percentile(input.remote, 0.5);
  if (directMedianMs === null || remoteMedianMs === null) return null;
  const addedMs = remoteMedianMs - directMedianMs;
  return {
    addedMs,
    directMedianMs,
    remoteMedianMs,
    throttleVisible: addedMs >= THROTTLE_VISIBLE_MS,
  };
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
