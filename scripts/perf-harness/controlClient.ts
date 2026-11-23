// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off - a Promise-based host-side client of the harness's own throwaway server.
/**
 * The web performance harness's own connection to the scenario's server,
 * beside the browser: a bearer from `auth session issue` against the
 * scenario's home, HTTP `POST /api/orchestration/dispatch` to start turns
 * without touching the page, and an Effect RPC client over WebSocket (with a
 * ticket from `/api/auth/websocket-ticket`) for `server.getPerformanceMetrics`
 * and, in the soak, `subscribeShell`. The socket wiring follows
 * `packages/client-runtime/src/rpc/session.ts`.
 *
 * Its traffic is not in the browser's frames but is in the server's totals.
 *
 * @module perf-harness/controlClient
 */
import * as NodePath from "node:path";

import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {
  AuthWebSocketTicketResult,
  ClientOrchestrationCommand,
  DispatchResult,
  ORCHESTRATION_PROTOCOL_QUERY_PARAM,
  ORCHESTRATION_PROTOCOL_VERSION,
  OrchestrationShellSnapshot,
  WsRpcGroup,
  type OrchestrationShellStreamItem,
} from "@e6tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";

import { runNodeScript, serverBinPath } from "./serverProcess.ts";

/** A bearer with administrative scopes for the scenario's home; its output never reaches a log. */
export async function issueBearer(input: {
  readonly home: string;
  readonly env: Record<string, string>;
  readonly cwd: string;
  readonly logDir: string;
}): Promise<{ readonly token: string; readonly pid: number }> {
  const { pid, lines } = await runNodeScript(
    [
      serverBinPath,
      "auth",
      "session",
      "issue",
      "--base-dir",
      input.home,
      "--label",
      "perf-harness-control",
      "--token-only",
    ],
    {
      env: input.env,
      cwd: input.cwd,
      logPath: NodePath.join(input.logDir, "auth.log"),
      secretOutput: true,
    },
  );
  const token = lines
    .map((line) => line.trim())
    .findLast((line) => line.length > 0 && !line.includes(" "));
  if (token === undefined) throw new Error("auth session issue printed no token");
  return { token, pid };
}

export type ClientCommand = typeof ClientOrchestrationCommand.Encoded;

const validateCommand = Schema.decodeUnknownSync(ClientOrchestrationCommand);
const decodeDispatch = Schema.decodeUnknownSync(Schema.toCodecJson(DispatchResult));
const decodeShell = Schema.decodeUnknownSync(Schema.toCodecJson(OrchestrationShellSnapshot));
const decodeTicket = Schema.decodeUnknownSync(Schema.toCodecJson(AuthWebSocketTicketResult));

/** A user turn on `threadId`, as the composer would send it, with no attachments. */
export function turnStartCommand(input: {
  readonly id: string;
  readonly threadId: string;
  readonly text: string;
  readonly atMs: number;
}): ClientCommand {
  return {
    type: "thread.turn.start",
    commandId: `perf-harness:${input.id}`,
    threadId: input.threadId,
    message: {
      messageId: `perf-harness-message:${input.id}`,
      role: "user",
      text: input.text,
      attachments: [],
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt: new Date(input.atMs).toISOString(),
  };
}

const makeRpcClient = RpcClient.make(WsRpcGroup);
type HarnessRpcClient = Effect.Success<typeof makeRpcClient>;

export interface ControlRpc {
  readonly getPerformanceMetrics: () => Promise<
    Effect.Success<ReturnType<HarnessRpcClient["server.getPerformanceMetrics"]>>
  >;
  /** Follows the shell; `stop` ends the subscription. */
  readonly subscribeShell: (onItem: (item: OrchestrationShellStreamItem) => void) => {
    readonly stop: () => Promise<void>;
    /** Settles when the stream ends: with an error, or `null` when stopped or finished. */
    readonly ended: Promise<unknown>;
  };
  readonly close: () => Promise<void>;
}

export interface ControlClient {
  readonly dispatch: (
    command: ClientCommand,
  ) => Promise<
    | { readonly ok: true; readonly sequence: number }
    | { readonly ok: false; readonly status: number; readonly body: string }
  >;
  readonly shellSnapshot: () => Promise<OrchestrationShellSnapshot>;
  readonly openRpc: () => Promise<ControlRpc>;
}

export function controlClient(input: {
  readonly origin: string;
  readonly token: string;
}): ControlClient {
  const headers = { authorization: `Bearer ${input.token}`, "content-type": "application/json" };
  const url = (path: string) => new URL(path, input.origin).toString();

  const openRpc = async (): Promise<ControlRpc> => {
    const ticketResponse = await fetch(url("/api/auth/websocket-ticket"), {
      method: "POST",
      headers,
    });
    if (!ticketResponse.ok) {
      throw new Error(`websocket ticket request failed with ${ticketResponse.status}`);
    }
    const { ticket } = decodeTicket(await ticketResponse.json());
    const socketUrl = new URL("/ws", input.origin);
    socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
    socketUrl.searchParams.set("wsTicket", ticket);
    socketUrl.searchParams.set(
      ORCHESTRATION_PROTOCOL_QUERY_PARAM,
      String(ORCHESTRATION_PROTOCOL_VERSION),
    );
    const protocolLayer = RpcClient.layerProtocolSocket().pipe(
      Layer.provide(
        Socket.layerWebSocket(socketUrl.toString(), { openTimeout: "10 seconds" }).pipe(
          Layer.provide(NodeSocket.layerWebSocketConstructor),
        ),
      ),
      Layer.provide(RpcSerialization.layerJson),
    );
    const scope = Scope.makeUnsafe();
    const client = await Effect.runPromise(
      Effect.gen(function* () {
        const protocol = yield* Layer.buildWithScope(protocolLayer, scope);
        return yield* makeRpcClient.pipe(Effect.provide(protocol), Scope.provide(scope));
      }),
    );
    return {
      getPerformanceMetrics: () => Effect.runPromise(client["server.getPerformanceMetrics"]({})),
      subscribeShell: (onItem) => {
        const fiber = Effect.runFork(
          client["orchestration.subscribeShell"]({}).pipe(
            Stream.runForEach((item) => Effect.sync(() => onItem(item))),
          ),
        );
        return {
          stop: () => Effect.runPromise(Fiber.interrupt(fiber)),
          ended: Effect.runPromise(Fiber.await(fiber)).then((exit) =>
            Exit.isFailure(exit) && !Cause.hasInterrupts(exit.cause) ? exit.cause : null,
          ),
        };
      },
      close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
    };
  };

  return {
    dispatch: async (command) => {
      validateCommand(command);
      const response = await fetch(url("/api/orchestration/dispatch"), {
        method: "POST",
        headers,
        body: JSON.stringify(command),
      });
      const text = await response.text();
      if (!response.ok) return { ok: false, status: response.status, body: text.slice(0, 500) };
      return { ok: true, sequence: decodeDispatch(JSON.parse(text)).sequence };
    },
    shellSnapshot: async () => {
      const response = await fetch(url("/api/orchestration/shell"), { headers });
      if (!response.ok) throw new Error(`shell snapshot request failed with ${response.status}`);
      return decodeShell(await response.json());
    },
    openRpc,
  };
}
