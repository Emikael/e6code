import { EventId, ProviderDriverKind } from "@e6tools/contracts";
import * as Effect from "effect/Effect";

import { runAdapterContract } from "../src/provider/testUtils/adapterContract.ts";
import {
  type FixtureProviderRuntimeEvent,
  makeTestProviderAdapterHarness,
} from "./TestProviderAdapter.integration.ts";

const provider = ProviderDriverKind.make("codex");

const plainTurn = (): ReadonlyArray<FixtureProviderRuntimeEvent> =>
  [
    { type: "turn.started", payload: {} },
    {
      type: "content.delta",
      itemId: "msg-1",
      payload: { streamKind: "assistant_text", delta: "Hello." },
    },
    { type: "turn.completed", payload: { state: "completed" } },
  ].map((event) => ({
    ...event,
    eventId: EventId.make("fixture"),
    provider,
    createdAt: "2026-01-01T00:00:00.000Z",
    threadId: "fixture-thread",
    turnId: "fixture-turn",
  }));

// The scripted adapter emits each turn synchronously inside sendTurn and does
// not pause on approvals, so it runs the core checks only.
runAdapterContract({
  name: "TestProviderAdapter",
  provider,
  makeSubject: () =>
    Effect.map(makeTestProviderAdapterHarness({ provider }), (harness) => ({
      adapter: harness.adapter,
      arrangeTurn: (threadId) => harness.queueTurnResponse(threadId, { events: plainTurn() }),
    })),
  validatesProviderMismatch: true,
  gates: false,
  nativeApprovalFeedback: false,
});
