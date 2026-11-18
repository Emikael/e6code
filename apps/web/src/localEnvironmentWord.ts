import type { DesktopLocalEnvironmentStatus } from "@e6tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { localEnvironmentStatusAtom } from "./localEnvironmentStatus";

/** A normal start reads "Still starting…" once it has run this long. */
export const STILL_STARTING_AFTER_MS = 15_000;

export type LocalEnvironmentWordKind = "starting" | "still-starting" | "restarting" | "failed";

/**
 * How the desktop's local environment reads while it is not ready, shared by every surface
 * that names it: the sidebar line, the thread-header chip, the composer notice, the send toast,
 * the command palette and the starting panel. Ready and deliberately stopped environments have
 * no starting word; those surfaces keep their connection wording.
 */
export interface LocalEnvironmentWord {
  readonly kind: LocalEnvironmentWordKind;
  readonly word: "Starting…" | "Still starting…" | "Restarting…" | "Couldn't start";
  /** Picks the dot through `connectionPhaseDotClassName`; the word always carries the state. */
  readonly dotPhase: "connecting" | "reconnecting" | "error";
  /** The restart count since the backend was last ready, from 1; `null` for a planned restart. */
  readonly attempt: number | null;
  /** One raw line from the desktop for an unplanned restart or a failure; `null` otherwise. */
  readonly reason: string | null;
  /** When the wording escalates on its own; `null` when it never does. */
  readonly escalatesAtEpochMs: number | null;
}

export function localEnvironmentWord(
  status: DesktopLocalEnvironmentStatus | null | undefined,
  nowEpochMs: number,
): LocalEnvironmentWord | null {
  if (status == null) return null;
  switch (status.state) {
    case "ready":
    case "stopped":
      return null;
    case "failed":
      return {
        kind: "failed",
        word: "Couldn't start",
        dotPhase: "error",
        attempt: null,
        reason: status.reason,
        escalatesAtEpochMs: null,
      };
    case "restarting": {
      const attempt = status.restartAttempt >= 1 ? status.restartAttempt : null;
      return {
        kind: "restarting",
        word: "Restarting…",
        dotPhase: "reconnecting",
        attempt,
        reason: attempt === null ? null : status.reason,
        escalatesAtEpochMs: null,
      };
    }
    case "starting": {
      const escalatesAtEpochMs = status.sinceEpochMs + STILL_STARTING_AFTER_MS;
      const still = nowEpochMs >= escalatesAtEpochMs;
      return {
        kind: still ? "still-starting" : "starting",
        word: still ? "Still starting…" : "Starting…",
        dotPhase: "connecting",
        attempt: null,
        reason: null,
        escalatesAtEpochMs: still ? null : escalatesAtEpochMs,
      };
    }
  }
}

export interface LocalEnvironmentDetailLine {
  readonly text: string;
  /** Raw reasons from the desktop read in mono. */
  readonly mono: boolean;
}

export const NO_REASON_REPORTED = "No reason was reported.";

/** The lines a tooltip adds under `{label} · {word}`; none for a plain start. */
export function localEnvironmentDetailLines(
  word: LocalEnvironmentWord,
): ReadonlyArray<LocalEnvironmentDetailLine> {
  switch (word.kind) {
    case "starting":
      return [];
    case "still-starting":
      return [{ text: "Taking longer than usual.", mono: false }];
    case "restarting":
      return word.attempt === null
        ? []
        : [
            { text: `Stopped unexpectedly. Trying again, attempt ${word.attempt}.`, mono: false },
            ...(word.reason === null ? [] : [{ text: word.reason, mono: true }]),
          ];
    case "failed":
      return [
        word.reason === null
          ? { text: NO_REASON_REPORTED, mono: false }
          : { text: word.reason, mono: true },
      ];
  }
}

export interface LocalEnvironmentNoticeCopy {
  readonly variant: "default" | "warning" | "error";
  /** `dot` is the neutral dot of a calm, expected wait. */
  readonly icon: "dot" | "restart" | "alert";
  readonly title: string;
  readonly description: string | null;
  readonly reason: LocalEnvironmentDetailLine | null;
}

/** The composer notice for a thread on the local environment while it is not ready. */
export function localEnvironmentNoticeCopy(word: LocalEnvironmentWord): LocalEnvironmentNoticeCopy {
  switch (word.kind) {
    case "starting":
      return {
        variant: "default",
        icon: "dot",
        title: "Starting the local environment",
        description: "You can send once it's ready.",
        reason: null,
      };
    case "still-starting":
      return {
        variant: "default",
        icon: "dot",
        title: "Still starting the local environment",
        description: "This is taking longer than usual.",
        reason: null,
      };
    case "restarting":
      return word.attempt === null
        ? {
            variant: "default",
            icon: "dot",
            title: "Restarting the local environment",
            description: null,
            reason: null,
          }
        : {
            variant: "warning",
            icon: "restart",
            title: "Restarting the local environment",
            description: `It stopped unexpectedly (attempt ${word.attempt}).`,
            reason: word.reason === null ? null : { text: word.reason, mono: true },
          };
    case "failed":
      return {
        variant: "error",
        icon: "alert",
        title: "The local environment couldn't start",
        description: null,
        reason:
          word.reason === null
            ? { text: NO_REASON_REPORTED, mono: false }
            : { text: word.reason, mono: true },
      };
  }
}

/** The toast when a send to the local environment is refused; the draft text stays. */
export function localEnvironmentSendToastCopy(word: LocalEnvironmentWord): {
  readonly title: string;
  readonly description: string;
} {
  const description =
    word.kind === "failed"
      ? "The local environment couldn't start."
      : word.kind === "restarting"
        ? "The local environment is restarting. Try again once it's ready."
        : "The local environment is still starting. Try again once it's ready.";
  return { title: "Message not sent", description };
}

export type LocalEnvironmentPanelPlacement = "window" | "stage";

export interface LocalEnvironmentPanelCopy {
  readonly title: string;
  /** Read out by the live region with the title. */
  readonly lines: ReadonlyArray<string>;
  /** Kept out of the live region, so a retry every few seconds is not announced each time. */
  readonly attempt: string | null;
  readonly reason: LocalEnvironmentDetailLine | null;
}

/**
 * The starting panel's words: `window` replaces the first-run wait, `stage` stands in for the
 * main area while there is nothing local to show. `waitingProject` is set when the stage stands
 * in front of a cached local project whose draft opens once the environment is ready, so the
 * sidebar already lists projects and threads. A planned restart reads as a start.
 */
export function localEnvironmentPanelCopy(
  word: LocalEnvironmentWord | null,
  input: {
    readonly placement: LocalEnvironmentPanelPlacement;
    readonly label: string | null;
    readonly waitingProject?: boolean;
  },
): LocalEnvironmentPanelCopy {
  const window = input.placement === "window";
  const failure =
    word !== null &&
    (word.kind === "failed" || (word.kind === "restarting" && word.attempt !== null));
  if (failure) {
    return {
      title: window
        ? "E6 Code couldn't start its local environment"
        : "The local environment couldn't start",
      lines: [],
      attempt: word.attempt === null ? null : `Trying again (attempt ${word.attempt}).`,
      reason:
        word.reason === null
          ? word.kind === "failed"
            ? { text: NO_REASON_REPORTED, mono: false }
            : null
          : { text: word.reason, mono: true },
    };
  }
  // The bootstrap label names a WSL primary "WSL" or "WSL (<distro>)".
  const wsl = input.label?.startsWith("WSL") === true;
  const lines = window
    ? [wsl ? "Connecting to WSL…" : "Getting the local environment ready."]
    : [
        input.waitingProject === true
          ? "Your most recent project opens here once it's ready."
          : "Your projects and threads appear here once it's ready.",
      ];
  return {
    title: window ? "Starting E6 Code" : "Starting the local environment",
    lines:
      word?.kind === "still-starting" ? [...lines, "This is taking longer than usual."] : lines,
    attempt: null,
    reason: null,
  };
}

/**
 * The local environment's word, re-derived when the status changes and once more when a start
 * crosses the "still starting" threshold: one timer from `sinceEpochMs`, never an interval, so
 * a reload keeps the escalated wording and nothing repaints at idle.
 */
export const localEnvironmentWordAtom = Atom.make((get): LocalEnvironmentWord | null => {
  const word = localEnvironmentWord(get(localEnvironmentStatusAtom), Date.now());
  if (word?.escalatesAtEpochMs != null) {
    const timer = setTimeout(() => get.refreshSelf(), word.escalatesAtEpochMs - Date.now());
    get.addFinalizer(() => clearTimeout(timer));
  }
  return word;
}).pipe(Atom.keepAlive, Atom.withLabel("web-local-environment-word"));

/**
 * Whether the draft landing at `/` shows the starting panel instead of nothing while the
 * desktop's local environment is not ready: before the shell can choose a project, when there
 * is no project anywhere, and while the chosen project's draft waits for the local environment.
 * A remote project's draft opens as it always has.
 */
export function showsLocalEnvironmentStage(input: {
  readonly localStarting: boolean;
  readonly bootstrapped: boolean;
  readonly landingProjectEnvironmentId: string | null;
  readonly primaryEnvironmentId: string | null;
  readonly draftStartFailed: boolean;
}): boolean {
  if (!input.localStarting) return false;
  if (!input.bootstrapped || input.landingProjectEnvironmentId === null) return true;
  return (
    !input.draftStartFailed && input.landingProjectEnvironmentId === input.primaryEnvironmentId
  );
}
