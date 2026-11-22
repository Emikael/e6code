/**
 * What a scenario of the web performance harness is given and what it hands
 * back. A scenario runs against one server the harness started for it and
 * returns its metric outcomes, idle-frame points and raw measurements; the run
 * turns those into report rows. Reading the server's trace file waits until
 * the server has stopped and flushed it, through `afterStop`.
 *
 * @module perf-harness/scenarios/scenario
 */
// @effect-diagnostics nodeBuiltinImport:off - names screenshot files under the out directory.
import * as NodePath from "node:path";

import type { Browser, Cookie, Page } from "playwright-core";

import { screenshot, type MotionRequest } from "../browser.ts";
import type { ControlClient } from "../controlClient.ts";
import type { OtlpSink } from "../otlpSink.ts";
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
  readonly variant: "legacy" | "v2";
  readonly seed: SeededThreads;
  /** The scenario's own copy of the seeded home, which its server runs on. */
  readonly home: string;
  readonly server: {
    readonly pid: number;
    readonly rssKb: () => Promise<number | null>;
  };
  /** The harness's own bearer-authenticated client of this server, issued on first use. */
  readonly control: () => Promise<ControlClient>;
  /** The OTLP receiver this server exports metrics to, when the scenario asked for one. */
  readonly otlp: OtlpSink | null;
  readonly soak: { readonly minutes: number; readonly factor: number };
  readonly log: (message: string) => void;
}

export interface ValidityContribution {
  readonly motionResolved?: string | null;
  readonly eventTimingObserved?: boolean;
  readonly proxySelfTest?: { readonly rttMs: number; readonly mbps: number };
  readonly addedRpcRoundTripMs?: number | null;
  readonly notes?: ReadonlyArray<string>;
}

/** What a scenario adds once its server has stopped: rows read from its home's files. */
export interface AfterStop {
  /** Replaces the scenario's outcome of the same metric id, or adds one. */
  readonly metrics?: ReadonlyArray<MetricOutcome>;
  readonly raw?: Record<string, unknown>;
  readonly notes?: ReadonlyArray<string>;
}

export interface ScenarioResult {
  readonly metrics: ReadonlyArray<MetricOutcome>;
  /** `null` when the idle trace held no renderer main-thread events. */
  readonly idlePoints: ReadonlyArray<{ readonly label: string; readonly value: number | null }>;
  readonly raw: Record<string, unknown>;
  readonly screenshots: ReadonlyArray<{ readonly point: string; readonly path: string }>;
  readonly validity: ValidityContribution;
  /** Runs after the server stopped; `forced` when it had to be killed and may not have flushed. */
  readonly afterStop?: (input: {
    readonly home: string;
    readonly forced: boolean;
  }) => Promise<AfterStop>;
}

/** `screenshots/<scenario>.<point>.<variant>.<motion>.png` under the out directory. */
const screenshotName = (point: string, variant: "legacy" | "v2", motion: MotionRequest) =>
  `screenshots/${point}.${variant}.${motion}.png`;

/** The idle-frames point for `label`: its frame count, or null when the trace held no renderer data. */
export const idlePoint = (
  label: string,
  idle: { readonly framesWithUpdate: number; readonly rendererMainEvents: number },
) => ({ label, value: idle.rendererMainEvents > 0 ? idle.framesWithUpdate : null });

/**
 * Captures `point` when `--screenshots` is on and the idle check just proved
 * the page still; otherwise says why not. Never call it inside a window.
 */
export async function screenshotIfStill(
  ctx: ScenarioContext,
  page: Page,
  point: string,
  idle: { readonly framesWithUpdate: number; readonly rendererMainEvents: number },
): Promise<
  | { readonly taken: { readonly point: string; readonly path: string } }
  | { readonly skipped: string | null }
> {
  if (!ctx.screenshots) return { skipped: null };
  if (idle.rendererMainEvents === 0) {
    return { skipped: `${point} screenshot skipped: the idle trace held no renderer data` };
  }
  if (idle.framesWithUpdate > 0) {
    return { skipped: `${point} screenshot skipped: ${idle.framesWithUpdate} frames at idle` };
  }
  const path = NodePath.join(ctx.outDir, screenshotName(point, ctx.variant, ctx.motion));
  await screenshot(page, path);
  return { taken: { point, path } };
}
