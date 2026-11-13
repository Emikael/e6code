/**
 * The failure card's third sentence (board 7): what to do about it. The app
 * knows a fix only when the provider states one, as a command to run ("Codex
 * CLI is not authenticated. Run `codex login` and try again."), either in the
 * turn's error or in the provider's own status. Otherwise the card says what
 * Retry does, and says nothing when there is no Retry, rather than guess.
 */
export type FailureRemedy =
  | { readonly kind: "command"; readonly command: string }
  | { readonly kind: "retry" }
  | null;

const RUN_COMMAND = /\brun\s+`([^`\n]+)`/i;

export function failureRemedy(input: {
  /** The thread's full error text. */
  readonly error: string;
  /** The failed provider's status message, when it has one. */
  readonly providerMessage: string | null;
  readonly canRetry: boolean;
}): FailureRemedy {
  const command =
    RUN_COMMAND.exec(input.error)?.[1] ?? RUN_COMMAND.exec(input.providerMessage ?? "")?.[1];
  if (command?.trim()) return { kind: "command", command: command.trim() };
  return input.canRetry ? { kind: "retry" } : null;
}
