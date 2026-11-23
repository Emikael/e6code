/**
 * Where a page load landed when it was not the app, read off the
 * `e6:startup:landing:<surface>` mark. Only a pairing or sign-in landing means
 * the browser's credential did not carry; every other one is a real failure.
 *
 * @module perf-harness/scenarios/landing
 */
import type { StartupLanding } from "@e6tools/shared/startupMarks";

const AUTH_LANDINGS: ReadonlySet<string> = new Set<StartupLanding>(["pair", "requires-auth"]);

/** A load that landed on `landing` (`none` when no landing mark came) instead of the app. */
export class LandingError extends Error {
  readonly landing: string;

  constructor(landing: string) {
    super(`the load landed on '${landing}', not the app (seed or auth problem)`);
    this.landing = landing;
  }
}

/** Whether `error` is a load that landed on the pairing or sign-in surface. */
export const landedOnAuth = (error: unknown): error is LandingError =>
  error instanceof LandingError && AUTH_LANDINGS.has(error.landing);
