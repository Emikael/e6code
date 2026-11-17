/**
 * ReplayProviderAdapter - implements the provider adapter contract by playing
 * back a recorded canonical event stream, so servers, harnesses and demos get
 * realistic provider load without a provider CLI or credits.
 *
 * Every session plays the same recording. Each adapter call matches the next
 * recorded step (start, turn, approval answer, ...) and plays the events that
 * followed it, after their recorded delays scaled by `speed`. Playback pauses
 * at approvals and questions until they are answered, or answers them itself
 * with `autoRespond`. Ids are rewritten per session and per loop, so one
 * recording can drive many threads or a soak without colliding ids.
 *
 * @module provider/replay/ReplayProviderAdapter
 */
import {
  type ApprovalRequestId,
  EventId,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderUserInputAnswers,
  type ThreadId,
  TurnId,
} from "@e6tools/contracts";
import type {
  ProviderReplayRecording,
  RecordingEvent,
  RecordingStep,
} from "@e6tools/shared/testing/providerReplay/recording";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Random from "effect/Random";
import * as Scope from "effect/Scope";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { makeQueuedRuntimeEventStream } from "../runtimeEventStream.ts";
import type {
  ProviderAdapterShape,
  ProviderThreadSnapshot,
  ProviderThreadTurnSnapshot,
} from "../Services/ProviderAdapter.ts";
import { replayProfileFor, type ReplayProfile } from "./replayProfiles.ts";

export interface ReplayProviderAdapterOptions {
  readonly recording: ProviderReplayRecording;
  /** Playback speed multiplier, or "instant" to emit without waiting. Default 1. */
  readonly speed?: number | "instant";
  /** Caps any single recorded gap, in recorded milliseconds. */
  readonly maxGapMs?: number;
  /** After the last recorded turn: "loop" restarts under fresh ids, "fail" rejects. Default "fail". */
  readonly onExhausted?: "loop" | "fail";
  /** Answer approvals and questions with the recorded answer after the recorded delay. */
  readonly autoRespond?: boolean;
}

interface Segment {
  readonly step: RecordingStep | undefined;
  readonly events: ReadonlyArray<RecordingEvent>;
}

type Override =
  | { readonly kind: "request"; readonly decision: ProviderApprovalDecision }
  | { readonly kind: "user-input"; readonly answers: ProviderUserInputAnswers };

interface PlaybackJob {
  readonly segment: Segment;
  /** Position of `segment` in the recording. */
  readonly index: number;
  readonly loop: number;
  readonly override?: Override;
}

interface Playback {
  readonly queue: Queue.Queue<PlaybackJob>;
  readonly fiber: Fiber.Fiber<never, never>;
}

interface ReplaySession {
  session: ProviderSession;
  readonly ordinal: number;
  loop: number;
  /** Index into `segments` of the next step the recording expects. */
  cursor: number;
  activeTurnId: TurnId | undefined;
  /** Loop and segment index where the active turn's recording starts. */
  activeTurnStart: { readonly loop: number; readonly index: number } | undefined;
  readonly openRequests: Set<string>;
  readonly openUserInputs: Set<string>;
  turns: Array<ProviderThreadTurnSnapshot>;
  playback: Playback | undefined;
  /** The job playing now and the index of its next event. */
  inFlight: { readonly job: PlaybackJob; next: number } | undefined;
}

const PAYLOAD_ID_FIELDS = [
  "taskId",
  "agentId",
  "parentAgentId",
  "toolUseId",
  "parentToolUseId",
  "hookId",
] as const;
const DROPPED_FIELDS = ["raw", "providerRefs", "providerInstanceId"] as const;
const INSTANT_YIELD_EVERY = 64;

/** Splits a recording into segments: each step with the events that followed it. */
function segmentRecording(recording: ProviderReplayRecording): ReadonlyArray<Segment> {
  const segments: Array<{ step: RecordingStep | undefined; events: Array<RecordingEvent> }> = [];
  for (const line of recording.lines) {
    if (line.kind === "step") {
      segments.push({ step: line, events: [] });
      continue;
    }
    if (segments.length === 0) segments.push({ step: undefined, events: [] });
    segments.at(-1)!.events.push(line);
  }
  return segments;
}

const isTerminal = (event: ProviderRuntimeEvent) =>
  event.type === "turn.completed" || event.type === "turn.aborted";

export const makeReplayProviderAdapter = Effect.fn("makeReplayProviderAdapter")(function* (
  options: ReplayProviderAdapterOptions,
) {
  const scope = yield* Scope.Scope;
  const provider = options.recording.header.provider;
  const profile: ReplayProfile = replayProfileFor(provider);
  const speed = options.speed ?? 1;
  if (speed !== "instant" && !(Number.isFinite(speed) && speed > 0)) {
    return yield* new ProviderAdapterValidationError({
      provider,
      operation: "makeReplayProviderAdapter",
      issue: `speed must be a positive number or "instant", received ${String(speed)}`,
    });
  }
  const segments = segmentRecording(options.recording);
  const firstTurnIndex = segments.findIndex((segment) => segment.step?.on === "sendTurn");
  const runtimeEvents = yield* makeQueuedRuntimeEventStream;
  const sessions = new Map<ThreadId, ReplaySession>();
  let sessionCount = 0;

  const notFound = (threadId: ThreadId) =>
    new ProviderAdapterSessionNotFoundError({ provider, threadId });
  const requireSession = (threadId: ThreadId) =>
    Effect.suspend(() => {
      const state = sessions.get(threadId);
      return state ? Effect.succeed(state) : Effect.fail(notFound(threadId));
    });

  // Random per adapter so ids never collide with another replay, including a
  // rebuilt adapter replaying the same thread after a restart; ingestion keys
  // persisted rows on these ids.
  const namespace = `rp-${(yield* Random.nextIntBetween(0, 2 ** 31 - 1)).toString(36)}`;
  const remapId = (state: ReplaySession, loop: number, id: string) =>
    `${namespace}.${state.ordinal}.${loop}:${id}`;

  const toRuntimeEvent = (
    state: ReplaySession,
    job: PlaybackJob,
    recorded: ProviderRuntimeEvent,
    createdAt: string,
  ): ProviderRuntimeEvent => {
    const remap = (id: string) => remapId(state, job.loop, id);
    const event: Record<string, unknown> = { ...recorded };
    for (const field of DROPPED_FIELDS) delete event[field];
    event.provider = provider;
    event.threadId = state.session.threadId;
    event.createdAt = createdAt;
    event.eventId = EventId.make(remap(recorded.eventId));
    if (recorded.turnId !== undefined) event.turnId = remap(recorded.turnId);
    if (recorded.itemId !== undefined) event.itemId = remap(recorded.itemId);
    if (recorded.requestId !== undefined) event.requestId = remap(recorded.requestId);

    const payload = recorded.payload as Record<string, unknown> | undefined;
    if (payload !== undefined && typeof payload === "object" && payload !== null) {
      const next: Record<string, unknown> = { ...payload };
      for (const field of PAYLOAD_ID_FIELDS) {
        const value = next[field];
        if (typeof value === "string") next[field] = remap(value);
      }
      const preceding = next.precedingToolUseIds;
      if (Array.isArray(preceding)) {
        next.precedingToolUseIds = preceding.map((id) => (typeof id === "string" ? remap(id) : id));
      }
      if (recorded.type === "request.resolved" && job.override?.kind === "request") {
        next.decision = job.override.decision;
      }
      if (recorded.type === "user-input.resolved" && job.override?.kind === "user-input") {
        next.answers = job.override.answers;
      }
      event.payload = next;
    }
    return event as unknown as ProviderRuntimeEvent;
  };

  const touch = (state: ReplaySession, patch: Partial<ProviderSession>) =>
    Effect.map(DateTime.now, (now) => {
      state.session = { ...state.session, ...patch, updatedAt: DateTime.formatIso(now) };
    });

  /** Publishes one recorded event; `onEmitted` runs in the same uninterruptible step. */
  const emit = (
    state: ReplaySession,
    job: PlaybackJob,
    recorded: ProviderRuntimeEvent,
    onEmitted?: () => void,
  ) =>
    Effect.flatMap(DateTime.now, (now) =>
      Effect.sync(() => {
        const createdAt = DateTime.formatIso(now);
        const event = toRuntimeEvent(state, job, recorded, createdAt);
        if (event.type === "request.opened" && event.requestId !== undefined) {
          state.openRequests.add(event.requestId);
        } else if (event.type === "user-input.requested" && event.requestId !== undefined) {
          state.openUserInputs.add(event.requestId);
        } else if (isTerminal(event) && event.turnId === state.activeTurnId) {
          state.activeTurnId = undefined;
          const { activeTurnId: _activeTurnId, ...rest } = state.session;
          state.session = { ...rest, status: "ready", updatedAt: createdAt };
        }
        runtimeEvents.publishUnsafe(event);
        onEmitted?.();
      }),
    );

  const delayFor = (dt: number) => {
    if (speed === "instant") return 0;
    const capped = options.maxGapMs === undefined ? dt : Math.min(dt, options.maxGapMs);
    return capped / speed;
  };

  /** The respond step that comes next, when playback stopped at a gate. */
  const pendingGate = (state: ReplaySession) => {
    const step = segments[state.cursor]?.step;
    return step?.on === "respondToRequest" || step?.on === "respondToUserInput" ? step : undefined;
  };

  const playJob = Effect.fnUntraced(function* (state: ReplaySession, first: PlaybackJob) {
    let job: PlaybackJob | undefined = first;
    while (job !== undefined) {
      const inFlight = { job, next: 0 };
      state.inFlight = inFlight;
      for (const line of job.segment.events) {
        const delay = delayFor(line.dt);
        if (delay > 0) {
          yield* Effect.sleep(delay);
        } else if (speed === "instant" && (inFlight.next + 1) % INSTANT_YIELD_EVERY === 0) {
          yield* Effect.yieldNow;
        }
        yield* emit(state, job, line.event, () => {
          inFlight.next += 1;
        });
      }
      state.inFlight = undefined;
      // With autoRespond, the recorded user answers a gate that directly
      // follows this segment after the recorded think time.
      const gateIndex = job.index + 1;
      job = undefined;
      const gate =
        options.autoRespond && state.cursor === gateIndex ? pendingGate(state) : undefined;
      if (gate !== undefined) {
        const delay = delayFor(gate.dt);
        if (delay > 0) yield* Effect.sleep(delay);
        // A manual answer may have arrived while waiting; it wins.
        if (state.cursor === gateIndex) job = takeGate(state, gate);
      }
    }
  });

  /** Consumes the gate step at the cursor and returns the job that plays it. */
  const takeGate = (
    state: ReplaySession,
    step: Extract<RecordingStep, { on: "respondToRequest" | "respondToUserInput" }>,
    override?: Override,
  ): PlaybackJob => {
    const index = state.cursor;
    const segment = segments[index]!;
    state.cursor += 1;
    const requestId = remapId(state, state.loop, step.requestId);
    if (step.on === "respondToRequest") {
      state.openRequests.delete(requestId);
      return {
        segment,
        index,
        loop: state.loop,
        override: override ?? { kind: "request", decision: step.decision },
      };
    }
    state.openUserInputs.delete(requestId);
    return {
      segment,
      index,
      loop: state.loop,
      override: override ?? { kind: "user-input", answers: step.answers },
    };
  };

  const startPlayback = Effect.fnUntraced(function* (state: ReplaySession) {
    const queue = yield* Queue.unbounded<PlaybackJob>();
    const fiber = yield* Effect.forever(
      Effect.flatMap(Queue.take(queue), (job) => playJob(state, job)),
    ).pipe(Effect.forkIn(scope));
    state.playback = { queue, fiber };
  });

  const stopPlayback = Effect.fnUntraced(function* (state: ReplaySession) {
    const playback = state.playback;
    state.playback = undefined;
    state.inFlight = undefined;
    if (playback === undefined) return;
    yield* Fiber.interrupt(playback.fiber);
    yield* Queue.shutdown(playback.queue);
  });

  const enqueue = (state: ReplaySession, job: PlaybackJob) =>
    state.playback ? Queue.offer(state.playback.queue, job).pipe(Effect.asVoid) : Effect.void;

  /** Emits recorded events at once, in order; used where the call must not return first. */
  const emitNow = Effect.fnUntraced(function* (state: ReplaySession, index: number) {
    const segment = segments[index]!;
    const job: PlaybackJob = { segment, index, loop: state.loop };
    for (const line of segment.events) yield* emit(state, job, line.event);
  });

  const interruptTerminal = (state: ReplaySession, turnId: TurnId, createdAt: string) => {
    const base = {
      eventId: EventId.make(remapId(state, state.loop, `interrupt:${turnId}`)),
      provider,
      threadId: state.session.threadId,
      createdAt,
      turnId,
    };
    return profile.interruptTerminal === "aborted"
      ? ({ ...base, type: "turn.aborted", payload: { reason: "interrupted" } } as const)
      : ({
          ...base,
          type: "turn.completed",
          payload: {
            state:
              profile.interruptTerminal === "completed-cancelled" ? "cancelled" : "interrupted",
          },
        } as const);
  };

  const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = (input) =>
    Effect.gen(function* () {
      if (
        profile.validatesProviderMismatch &&
        input.provider !== undefined &&
        input.provider !== provider
      ) {
        return yield* new ProviderAdapterValidationError({
          provider,
          operation: "startSession",
          issue: `Expected provider '${provider}' but received '${input.provider}'.`,
        });
      }
      const existing = sessions.get(input.threadId);
      if (existing) {
        yield* stopPlayback(existing);
        sessions.delete(input.threadId);
      }
      sessionCount += 1;
      const now = DateTime.formatIso(yield* DateTime.now);
      const state: ReplaySession = {
        session: {
          provider,
          ...(input.providerInstanceId !== undefined
            ? { providerInstanceId: input.providerInstanceId }
            : {}),
          status: "ready",
          runtimeMode: input.runtimeMode,
          threadId: input.threadId,
          ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
          ...(input.modelSelection?.model !== undefined
            ? { model: input.modelSelection.model }
            : {}),
          resumeCursor: input.resumeCursor ?? { replay: options.recording.header.id },
          createdAt: now,
          updatedAt: now,
        },
        ordinal: sessionCount,
        loop: 0,
        cursor: 0,
        activeTurnId: undefined,
        activeTurnStart: undefined,
        openRequests: new Set(),
        openUserInputs: new Set(),
        turns: [],
        playback: undefined,
        inFlight: undefined,
      };
      sessions.set(input.threadId, state);
      yield* startPlayback(state);
      const first = segments[0];
      if (first !== undefined && (first.step === undefined || first.step.on === "startSession")) {
        state.cursor = 1;
        yield* enqueue(state, { segment: first, index: 0, loop: 0 });
      }
      return state.session;
    });

  /** Finds the next recorded turn, looping when the recording allows it. */
  const nextTurnIndex = (state: ReplaySession) => {
    for (let index = state.cursor; index < segments.length; index += 1) {
      if (segments[index]?.step?.on === "sendTurn") return index;
    }
    return undefined;
  };

  const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = (input) =>
    Effect.gen(function* () {
      const state = yield* requireSession(input.threadId);
      if (state.activeTurnId !== undefined) {
        return yield* new ProviderAdapterValidationError({
          provider,
          operation: "sendTurn",
          issue: `Turn ${state.activeTurnId} is still running.`,
        });
      }
      let index = nextTurnIndex(state);
      if (index === undefined && options.onExhausted === "loop" && firstTurnIndex >= 0) {
        state.loop += 1;
        index = firstTurnIndex;
      }
      if (index === undefined) {
        return yield* new ProviderAdapterValidationError({
          provider,
          operation: "sendTurn",
          issue: `Recording '${options.recording.header.id}' has no more turns.`,
        });
      }
      const segment = segments[index]!;
      const step = segment.step as Extract<RecordingStep, { on: "sendTurn" }>;
      state.cursor = index + 1;
      const turnId = TurnId.make(remapId(state, state.loop, step.turnId));
      state.activeTurnId = turnId;
      state.activeTurnStart = { loop: state.loop, index };
      state.turns.push({ id: turnId, items: [] });
      yield* touch(state, { status: "running", activeTurnId: turnId });
      yield* enqueue(state, { segment, index, loop: state.loop });
      return { threadId: input.threadId, turnId };
    });

  const respondToRequest: ProviderAdapterShape<ProviderAdapterError>["respondToRequest"] = (
    threadId,
    requestId,
    decision,
  ) =>
    Effect.gen(function* () {
      const state = yield* requireSession(threadId);
      const gate = pendingGate(state);
      if (
        !state.openRequests.has(requestId) ||
        gate?.on !== "respondToRequest" ||
        remapId(state, state.loop, gate.requestId) !== requestId
      ) {
        return yield* new ProviderAdapterRequestError({
          provider,
          method: "respondToRequest",
          detail: `Unknown pending approval request: ${requestId}`,
        });
      }
      yield* enqueue(state, takeGate(state, gate, { kind: "request", decision }));
    });

  const respondToUserInput: ProviderAdapterShape<ProviderAdapterError>["respondToUserInput"] = (
    threadId,
    requestId: ApprovalRequestId,
    answers,
  ) =>
    Effect.gen(function* () {
      const state = yield* requireSession(threadId);
      const gate = pendingGate(state);
      if (
        !state.openUserInputs.has(requestId) ||
        gate?.on !== "respondToUserInput" ||
        remapId(state, state.loop, gate.requestId) !== requestId
      ) {
        return yield* new ProviderAdapterRequestError({
          provider,
          method: "respondToUserInput",
          detail: `Unknown pending user input request: ${requestId}`,
        });
      }
      yield* enqueue(state, takeGate(state, gate, { kind: "user-input", answers }));
    });

  const interruptTurn: ProviderAdapterShape<ProviderAdapterError>["interruptTurn"] = (
    threadId,
    turnId,
  ) =>
    Effect.gen(function* () {
      const state = yield* requireSession(threadId);
      const activeTurnId = state.activeTurnId;
      if (activeTurnId === undefined || (turnId !== undefined && turnId !== activeTurnId)) {
        return;
      }
      // The rest of this turn is cut off. Anything else still waiting to play,
      // such as the session's start events, is emitted now in order.
      const inFlight = state.inFlight;
      const queued = state.playback ? yield* Queue.clear(state.playback.queue) : [];
      yield* stopPlayback(state);
      state.inFlight = undefined;
      const pending = [
        ...(inFlight ? [{ job: inFlight.job, from: inFlight.next }] : []),
        ...queued.map((job) => ({ job, from: 0 })),
      ];
      const turnStart = state.activeTurnStart;
      for (const { job, from } of pending) {
        // What the recording put before this turn survives, such as session
        // start or a finished turn's late usage; every segment of the turn is cut.
        const beforeTurn =
          turnStart === undefined ||
          job.loop < turnStart.loop ||
          (job.loop === turnStart.loop && job.index < turnStart.index);
        if (!beforeTurn) continue;
        for (const line of job.segment.events.slice(from)) {
          yield* emit(state, job, line.event);
        }
      }
      state.openRequests.clear();
      state.openUserInputs.clear();
      yield* startPlayback(state);
      const interruptIndex = state.cursor;
      const recordedInterrupt = segments[interruptIndex];
      if (recordedInterrupt?.step?.on === "interruptTurn") {
        state.cursor += 1;
        yield* enqueue(state, {
          segment: recordedInterrupt,
          index: interruptIndex,
          loop: state.loop,
        });
        return;
      }
      // Skip the rest of the recorded turn and end it the way this provider does.
      const next = nextTurnIndex(state);
      state.cursor = next ?? segments.length;
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      state.activeTurnId = undefined;
      const { activeTurnId: _activeTurnId, ...rest } = state.session;
      state.session = { ...rest, status: "ready", updatedAt: createdAt };
      yield* runtimeEvents.publish(interruptTerminal(state, activeTurnId, createdAt));
    });

  const stopSession: ProviderAdapterShape<ProviderAdapterError>["stopSession"] = (threadId) =>
    Effect.gen(function* () {
      const state = yield* requireSession(threadId);
      yield* stopPlayback(state);
      if (segments[state.cursor]?.step?.on === "stopSession") {
        state.cursor += 1;
        yield* emitNow(state, state.cursor - 1);
      }
      sessions.delete(threadId);
    });

  const readThread: ProviderAdapterShape<ProviderAdapterError>["readThread"] = (threadId) =>
    Effect.map(requireSession(threadId), (state): ProviderThreadSnapshot => ({
      threadId,
      turns: [...state.turns],
    }));

  const rollbackThread: ProviderAdapterShape<ProviderAdapterError>["rollbackThread"] = (
    threadId,
    numTurns,
  ) =>
    Effect.gen(function* () {
      const state = yield* requireSession(threadId);
      if (profile.capabilities.supportsConversationRollback === false) {
        return yield* new ProviderAdapterValidationError({
          provider,
          operation: "rollbackThread",
          issue: "This provider cannot roll back conversation history.",
        });
      }
      if (!Number.isInteger(numTurns) || numTurns < 0 || numTurns > state.turns.length) {
        return yield* new ProviderAdapterValidationError({
          provider,
          operation: "rollbackThread",
          issue: "numTurns must be an integer between 0 and current turn count.",
        });
      }
      state.turns = state.turns.slice(0, state.turns.length - numTurns);
      return { threadId, turns: [...state.turns] };
    });

  const stopAll: ProviderAdapterShape<ProviderAdapterError>["stopAll"] = () =>
    Effect.forEach([...sessions.keys()], (threadId) => stopSession(threadId), {
      discard: true,
    });

  const adapter: ProviderAdapterShape<ProviderAdapterError> = {
    provider,
    capabilities: profile.capabilities,
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions: () => Effect.sync(() => Array.from(sessions.values(), (state) => state.session)),
    hasSession: (threadId) => Effect.sync(() => sessions.has(threadId)),
    readThread,
    rollbackThread,
    stopAll,
    runtimeEventSequence: runtimeEvents.runtimeEventSequence,
    subscribeRuntimeEvents: runtimeEvents.subscribeRuntimeEvents,
    streamEvents: runtimeEvents.streamEvents,
  };
  return adapter;
});
