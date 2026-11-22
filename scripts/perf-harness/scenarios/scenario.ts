/**
 * What a scenario of the web performance harness is given and what it hands
 * back. A scenario runs against one server the harness started for it and
 * returns its metric outcomes, idle-frame points and raw measurements; the run
 * turns those into report rows.
 *
 * @module perf-harness/scenarios/scenario
 */
import type { Browser, Cookie } from "playwright-core";

import type { MotionRequest } from "../browser.ts";
import type { MetricOutcome } from "../report.ts";

export interface SeededThreads {
  readonly projectId: string;
  readonly longThreadId: string | null;
  readonly threads: number;
}

export interface ScenarioContext {
  readonly browser: Browser;
  /** The server's own origin, `http://127.0.0.1:<port>`. */
  readonly origin: string;
  readonly serverPort: number;
  readonly cookies: ReadonlyArray<Cookie>;
  /** Pairs a fresh browser credential through `origin`, for when cookies do not carry over. */
  readonly pairAt: (origin: string) => Promise<Array<Cookie>>;
  readonly motion: MotionRequest;
  readonly distDir: string;
  readonly outDir: string;
  /** Where traces are kept with `--keep-traces`; `null` drops them after analysis. */
  readonly traceDir: string | null;
  readonly screenshots: boolean;
  readonly seed: SeededThreads;
  readonly log: (message: string) => void;
}

export interface ValidityContribution {
  readonly motionResolved?: string | null;
  readonly eventTimingObserved?: boolean;
  readonly proxySelfTest?: { readonly rttMs: number; readonly mbps: number };
  readonly addedRpcRoundTripMs?: number | null;
  readonly notes?: ReadonlyArray<string>;
}

export interface ScenarioResult {
  readonly metrics: ReadonlyArray<MetricOutcome>;
  readonly idlePoints: ReadonlyArray<{ readonly label: string; readonly value: number }>;
  readonly raw: Record<string, unknown>;
  readonly screenshots: ReadonlyArray<{ readonly point: string; readonly path: string }>;
  readonly validity: ValidityContribution;
}

/** `screenshots/<scenario>.<point>.<variant>.<motion>.png` under the out directory. */
export const screenshotName = (point: string, motion: MotionRequest) =>
  `screenshots/${point}.legacy.${motion}.png`;
