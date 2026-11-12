import type { EnvironmentId, ThreadId } from "@e6tools/contracts";
import * as Effect from "effect/Effect";

import type * as MobileDatabase from "./mobile-database";

/**
 * When you last had a thread open on this device, for "Where you left off"
 * (F4). Two clocks, as on web: `visitedAt` is this device's and decides the
 * break; `seenActivityAt` is the newest activity you had on screen, on the
 * server's clock, and decides whether anything is new.
 */
export interface ThreadVisit {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly visitedAt: string;
  readonly seenActivityAt: string | null;
}

const CACHE_KIND = "thread-visit";
const CACHE_SCHEMA_VERSION = 1;

const visits = new Map<string, ThreadVisit>();
let database: MobileDatabase.MobileDatabase["Service"] | undefined;

const visitKey = (environmentId: EnvironmentId, threadId: ThreadId) =>
  `${environmentId}:${threadId}`;

/** A stored row, or null when it is not one this version wrote. */
export function decodeThreadVisit(payload: string): ThreadVisit | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.environmentId !== "string" ||
    typeof record.threadId !== "string" ||
    typeof record.visitedAt !== "string" ||
    Number.isNaN(Date.parse(record.visitedAt)) ||
    (record.seenActivityAt !== null && typeof record.seenActivityAt !== "string")
  ) {
    return null;
  }
  return {
    environmentId: record.environmentId as EnvironmentId,
    threadId: record.threadId as ThreadId,
    visitedAt: record.visitedAt,
    seenActivityAt: record.seenActivityAt as string | null,
  };
}

/**
 * Visits live in `client_cache`, so Settings → Client storage counts and
 * clears them. The environment cache store hands over the database it owns;
 * visits recorded before that stay in memory for the session.
 */
export function attachThreadVisitDatabase(service: MobileDatabase.MobileDatabase["Service"]) {
  database = service;
  void Effect.runPromise(service.listCache(CACHE_KIND))
    .then((payloads) => {
      for (const payload of payloads) {
        const visit = decodeThreadVisit(payload);
        const key = visit && visitKey(visit.environmentId, visit.threadId);
        // A visit recorded in this session is newer than the stored one.
        if (visit && key && !visits.has(key)) visits.set(key, visit);
      }
    })
    .catch(() => undefined);
}

export function readThreadVisit(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): ThreadVisit | null {
  return visits.get(visitKey(environmentId, threadId)) ?? null;
}

export function recordThreadVisit(visit: ThreadVisit): void {
  visits.set(visitKey(visit.environmentId, visit.threadId), visit);
  if (!database) return;
  void Effect.runPromise(
    database.saveCache(
      visit.environmentId,
      CACHE_KIND,
      visit.threadId,
      CACHE_SCHEMA_VERSION,
      JSON.stringify(visit),
    ),
  ).catch(() => undefined);
}
