// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - a host-side TCP proxy paces bytes with Node sockets and timers.
/**
 * A single-origin TCP proxy for the web performance harness's remote profile.
 * The browser talks to the proxy's port as if it were the server, so `Host`
 * and `Origin` stay one origin, and HTTP and WebSocket bytes are delayed alike.
 *
 * Shaped mode adds a fixed one-way latency per direction and paces each
 * direction through a token bucket shared by every connection, like one
 * constrained link. Passthrough mode forwards at once and only counts bytes.
 * Ends of stream travel through the same queue as data, so a response's tail
 * is never cut off by an early close.
 *
 * @module perf-harness/throttleProxy
 */
import * as NodeNet from "node:net";
import * as NodePerfHooks from "node:perf_hooks";

export interface ProxyClock {
  readonly now: () => number;
  readonly setTimeout: (run: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

const systemClock: ProxyClock = {
  now: () => NodePerfHooks.performance.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Latency and bucket rate for a round trip and a bandwidth; `burstMs` sizes the bucket. */
export function linkSettings(input: {
  readonly rttMs: number;
  readonly mbps: number;
  readonly burstMs: number;
}): { readonly latencyMs: number; readonly bytesPerMs: number; readonly burstBytes: number } {
  const bytesPerMs = (input.mbps * 1_000_000) / 8 / 1000;
  return {
    latencyMs: input.rttMs / 2,
    bytesPerMs,
    burstBytes: bytesPerMs * input.burstMs,
  };
}

/**
 * Paces bytes at `bytesPerMs`, letting up to `burstBytes` through at once.
 * Chunks leave in the order reserved; one larger than the burst leaves when
 * the bucket is full and leaves it in debt.
 */
export class TokenBucket {
  readonly #bytesPerMs: number;
  readonly #burstBytes: number;
  #tokens: number;
  #lastMs: number | null = null;

  constructor(options: { readonly bytesPerMs: number; readonly burstBytes: number }) {
    this.#bytesPerMs = options.bytesPerMs;
    this.#burstBytes = options.burstBytes;
    this.#tokens = options.burstBytes;
  }

  /** When a chunk of `bytes` arriving at `atMs` may leave; consumes its tokens. */
  reserve(atMs: number, bytes: number): number {
    const lastMs = this.#lastMs ?? atMs;
    const startMs = Math.max(atMs, lastMs);
    const tokens = Math.min(this.#burstBytes, this.#tokens + (startMs - lastMs) * this.#bytesPerMs);
    const needed = Math.min(bytes, this.#burstBytes);
    const waitMs = tokens >= needed ? 0 : (needed - tokens) / this.#bytesPerMs;
    const departMs = startMs + waitMs;
    this.#tokens = tokens + waitMs * this.#bytesPerMs - bytes;
    this.#lastMs = departMs;
    return departMs;
  }
}

/** One direction of the link: the bucket's release time plus the one-way latency. */
export class ShapedLink {
  readonly #latencyMs: number;
  readonly #bucket: TokenBucket | null;

  constructor(options: { readonly latencyMs: number; readonly bucket: TokenBucket | null }) {
    this.#latencyMs = options.latencyMs;
    this.#bucket = options.bucket;
  }

  deliveryTime(atMs: number, bytes: number): number {
    const departMs = this.#bucket === null ? atMs : this.#bucket.reserve(atMs, bytes);
    return departMs + this.#latencyMs;
  }
}

/** Delivers items in the order pushed, none before its time. */
export class DelayQueue<T> {
  readonly #clock: ProxyClock;
  readonly #deliver: (item: T) => void;
  readonly #items: Array<{ readonly item: T; readonly atMs: number }> = [];
  #timer: unknown = null;
  #closed = false;

  constructor(options: { readonly clock: ProxyClock; readonly deliver: (item: T) => void }) {
    this.#clock = options.clock;
    this.#deliver = options.deliver;
  }

  get pending(): number {
    return this.#items.length;
  }

  push(item: T, atMs: number): void {
    if (this.#closed) return;
    this.#items.push({ item, atMs });
    if (this.#timer === null) this.#drain();
  }

  close(): void {
    this.#closed = true;
    this.#items.length = 0;
    if (this.#timer !== null) this.#clock.clearTimeout(this.#timer);
    this.#timer = null;
  }

  #drain(): void {
    this.#timer = null;
    while (!this.#closed) {
      const head = this.#items[0];
      if (head === undefined) return;
      const waitMs = head.atMs - this.#clock.now();
      if (waitMs > 0) {
        this.#timer = this.#clock.setTimeout(() => this.#drain(), waitMs);
        return;
      }
      this.#items.shift();
      this.#deliver(head.item);
    }
  }
}

export type Direction = "clientToServer" | "serverToClient";

/** `METHOD /path` of the HTTP request a connection opened with, without its query; else null. */
export function requestTarget(firstChunk: Buffer): string | null {
  const line = firstChunk.subarray(0, 2_048).toString("latin1").split("\r\n", 1)[0] ?? "";
  const match = /^([A-Z]+) (\S+) HTTP\/1\.[01]$/.exec(line);
  if (match === null) return null;
  return `${match[1]} ${match[2]!.split("?", 1)[0]}`;
}

/** Bytes per connection and direction, with the request each connection opened with. */
export class ByteCounters {
  readonly #byConnection = new Map<number, Record<Direction, number>>();
  readonly #targets = new Map<number, string | null>();

  add(connection: number, direction: Direction, bytes: number): void {
    const entry = this.#byConnection.get(connection) ?? { clientToServer: 0, serverToClient: 0 };
    entry[direction] += bytes;
    this.#byConnection.set(connection, entry);
  }

  /** Records the connection's first request; later ones on a kept-alive connection do not rename it. */
  setTarget(connection: number, target: string | null): void {
    if (!this.#targets.has(connection)) this.#targets.set(connection, target);
  }

  totals(): Record<Direction, number> {
    const totals = { clientToServer: 0, serverToClient: 0 };
    for (const entry of this.#byConnection.values()) {
      totals.clientToServer += entry.clientToServer;
      totals.serverToClient += entry.serverToClient;
    }
    return totals;
  }

  connections(): Array<
    { readonly id: number; readonly target: string | null } & Record<Direction, number>
  > {
    return [...this.#byConnection.entries()]
      .toSorted(([left], [right]) => left - right)
      .map(([id, entry]) => ({ id, target: this.#targets.get(id) ?? null, ...entry }));
  }
}

/** Throughput after the first chunk arrived; `null` without a measurable span. */
export function throughputMbps(input: {
  readonly totalBytes: number;
  readonly firstChunkBytes: number;
  readonly firstByteMs: number;
  readonly lastByteMs: number;
}): number | null {
  const spanMs = input.lastByteMs - input.firstByteMs;
  if (spanMs <= 0) return null;
  return ((input.totalBytes - input.firstChunkBytes) * 8) / 1000 / spanMs;
}

export interface ThrottleProxyOptions {
  readonly targetHost: string;
  readonly targetPort: number;
  /** `shaped` delays and paces; `passthrough` only counts bytes. */
  readonly mode: "shaped" | "passthrough";
  readonly rttMs: number;
  readonly mbps: number;
  /** Bucket size as milliseconds of the link rate. */
  readonly burstMs?: number;
}

export interface ThrottleProxy {
  readonly port: number;
  readonly counters: ByteCounters;
  readonly close: () => Promise<void>;
}

type Item = { readonly kind: "data"; readonly chunk: Buffer } | { readonly kind: "end" };

/** Starts the proxy on a free loopback port. */
export async function startThrottleProxy(options: ThrottleProxyOptions): Promise<ThrottleProxy> {
  const clock = systemClock;
  const counters = new ByteCounters();
  const settings = linkSettings({
    rttMs: options.mode === "shaped" ? options.rttMs : 0,
    mbps: options.mbps,
    burstMs: options.burstMs ?? 4,
  });
  const makeLink = () =>
    options.mode === "shaped"
      ? new ShapedLink({
          latencyMs: settings.latencyMs,
          bucket: new TokenBucket({
            bytesPerMs: settings.bytesPerMs,
            burstBytes: settings.burstBytes,
          }),
        })
      : new ShapedLink({ latencyMs: 0, bucket: null });
  const links: Record<Direction, ShapedLink> = {
    clientToServer: makeLink(),
    serverToClient: makeLink(),
  };
  const sockets = new Set<NodeNet.Socket>();
  let nextConnection = 0;

  const server = NodeNet.createServer((client) => {
    nextConnection += 1;
    const connection = nextConnection;
    const upstream = NodeNet.createConnection({
      host: options.targetHost,
      port: options.targetPort,
    });
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.setNoDelay(true);
      socket.once("close", () => sockets.delete(socket));
    }
    const pipe = (from: NodeNet.Socket, to: NodeNet.Socket, direction: Direction) => {
      const queue = new DelayQueue<Item>({
        clock,
        deliver: (item) => {
          if (to.destroyed) return;
          if (item.kind === "data") to.write(item.chunk);
          else to.end();
        },
      });
      let ended = false;
      const endAfterQueued = () => {
        if (ended) return;
        ended = true;
        queue.push({ kind: "end" }, links[direction].deliveryTime(clock.now(), 0));
      };
      from.on("data", (chunk: Buffer) => {
        if (direction === "clientToServer") counters.setTarget(connection, requestTarget(chunk));
        counters.add(connection, direction, chunk.length);
        queue.push(
          { kind: "data", chunk },
          links[direction].deliveryTime(clock.now(), chunk.length),
        );
      });
      // Bytes already queued still go out before the other side is ended, after a reset too.
      from.on("end", endAfterQueued);
      from.on("close", endAfterQueued);
      return queue;
    };
    const queues = [
      pipe(client, upstream, "clientToServer"),
      pipe(upstream, client, "serverToClient"),
    ];
    const destroyBoth = () => {
      for (const queue of queues) queue.close();
      client.destroy();
      upstream.destroy();
    };
    client.on("error", destroyBoth);
    upstream.on("error", destroyBoth);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("throttle proxy did not bind a TCP port");
  }
  return {
    port: address.port,
    counters,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

const SELF_TEST_BYTES = 2_500_000;
const SELF_TEST_PINGS = 8;

/**
 * Measures the shaped link against a loopback test server: the median round
 * trip of one-byte echoes, and the rate at which the server's bulk send
 * arrives. Both should come back near the configured RTT and bandwidth.
 */
export async function runProxySelfTest(
  options: Omit<ThrottleProxyOptions, "targetHost" | "targetPort">,
): Promise<{ readonly rttMs: number; readonly mbps: number }> {
  const bulk = Buffer.alloc(SELF_TEST_BYTES, 0x61);
  const target = NodeNet.createServer((socket) => {
    socket.setNoDelay(true);
    socket.on("data", (chunk) => {
      if (chunk.includes(0x44)) socket.end(bulk);
      else socket.write(chunk);
    });
    socket.on("error", () => socket.destroy());
  });
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", () => resolve()));
  const targetAddress = target.address();
  if (targetAddress === null || typeof targetAddress === "string") {
    target.close();
    throw new Error("proxy self-test server did not bind a TCP port");
  }
  const proxy = await startThrottleProxy({
    ...options,
    targetHost: "127.0.0.1",
    targetPort: targetAddress.port,
  });
  try {
    const socket = NodeNet.createConnection({ host: "127.0.0.1", port: proxy.port });
    socket.setNoDelay(true);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", reject);
    });
    const rtts: Array<number> = [];
    for (let ping = 0; ping < SELF_TEST_PINGS; ping += 1) {
      const sentAt = NodePerfHooks.performance.now();
      await new Promise<void>((resolve) => {
        socket.once("data", () => resolve());
        socket.write("p");
      });
      rtts.push(NodePerfHooks.performance.now() - sentAt);
    }
    const received = await new Promise<{
      readonly total: number;
      readonly first: number;
      readonly firstAt: number;
      readonly lastAt: number;
    }>((resolve, reject) => {
      let total = 0;
      let first = 0;
      let firstAt = 0;
      let lastAt = 0;
      socket.on("data", (chunk: Buffer) => {
        const now = NodePerfHooks.performance.now();
        if (total === 0) {
          first = chunk.length;
          firstAt = now;
        }
        total += chunk.length;
        lastAt = now;
      });
      socket.once("end", () => resolve({ total, first, firstAt, lastAt }));
      socket.once("error", reject);
      socket.write("D");
    });
    socket.destroy();
    const sortedRtts = rtts.toSorted((left, right) => left - right);
    const mbps = throughputMbps({
      totalBytes: received.total,
      firstChunkBytes: received.first,
      firstByteMs: received.firstAt,
      lastByteMs: received.lastAt,
    });
    if (received.total !== SELF_TEST_BYTES || mbps === null) {
      throw new Error(`proxy self-test received ${received.total} of ${SELF_TEST_BYTES} bytes`);
    }
    return { rttMs: sortedRtts[Math.floor(sortedRtts.length / 2)]!, mbps };
  } finally {
    await proxy.close();
    await new Promise<void>((resolve) => target.close(() => resolve()));
  }
}
