import { memo } from "react";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { CircleAlertIcon, XIcon } from "lucide-react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function getThreadErrorBannerKey(threadKey: string, error: string | null): string | null {
  return error === null ? null : `${threadKey}\u0000${error}`;
}

export function shouldShowThreadErrorBanner(
  threadKey: string,
  error: string | null,
  isDismissed: boolean,
): boolean {
  return getThreadErrorBannerKey(threadKey, error) !== null && !isDismissed;
}

// Session-scoped (module-level so it survives ChatView remounts, e.g. route
// changes between threads). Mirrors the branch-mismatch banner: a dismissal
// is remembered per thread key plus message, so navigating away to a thread
// with no error cannot resurrect the banner, while a different error message
// on the same thread still appears.
const sessionDismissedThreadErrorBannerKeys = new Set<string>();

export function dismissThreadErrorBannerForSession(bannerKey: string | null): void {
  if (bannerKey !== null) {
    sessionDismissedThreadErrorBannerKeys.add(bannerKey);
  }
}

export function isThreadErrorBannerDismissedForSession(bannerKey: string | null): boolean {
  return bannerKey !== null && sessionDismissedThreadErrorBannerKeys.has(bannerKey);
}

/**
 * The thread's last error. `inline` renders it in the timeline's frontier slot,
 * where a failure belongs to the end of the conversation and cannot cover
 * earlier turns; `onContinue` then offers the composer as the way forward.
 */
export const ThreadErrorBanner = memo(function ThreadErrorBanner({
  error,
  onDismiss,
  onContinue,
  inline = false,
  failure,
  onRetry,
  onOpenTerminal,
  checkpointed = false,
}: {
  error: string | null;
  onDismiss?: () => void;
  onContinue?: () => void;
  inline?: boolean;
  /** "Codex stopped: the CLI is not signed in" (the now bar's sentence), when the turn failed. */
  failure?: string | null;
  /** Resends the last message; absent when it cannot be resent as it was. */
  onRetry?: (() => void) | null;
  onOpenTerminal?: () => void;
  /** A checkpoint exists, so the card can say the changes are safe. */
  checkpointed?: boolean;
}) {
  if (!error) return null;
  if (inline && failure) {
    // Board 7's failure card: what stopped, that the work is safe, and the ways forward.
    return (
      <article
        role="alert"
        className="flex w-full flex-col gap-2 rounded-xl border border-destructive-foreground bg-card px-4 py-3.5"
      >
        <span className="flex items-center gap-1.5 text-xs leading-4 font-medium text-destructive-foreground">
          <CircleAlertIcon aria-hidden className="size-3.5 shrink-0" />
          Failed
        </span>
        <p className="text-sm leading-[22px] text-foreground">
          {failure.endsWith(".") ? failure : `${failure}.`}
          {checkpointed ? " Your changes are safe in the last checkpoint." : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {onRetry ? (
            <Button size="sm" variant="outline" className="sm:text-xs" onClick={onRetry}>
              Retry
            </Button>
          ) : onContinue ? (
            <Button size="sm" variant="outline" className="sm:text-xs" onClick={onContinue}>
              Write a follow-up
            </Button>
          ) : null}
          {onOpenTerminal ? (
            <Button size="sm" variant="ghost" className="sm:text-xs" onClick={onOpenTerminal}>
              Open terminal
            </Button>
          ) : null}
        </div>
      </article>
    );
  }
  return (
    <div
      className={
        inline
          ? "w-full"
          : "pointer-events-auto mx-auto w-fit max-w-[min(48rem,calc(100%-2rem))] pt-3"
      }
    >
      <Alert
        variant="error"
        controlAlignment="first-line"
        className={inline ? undefined : "alert-glass"}
        data-variant="error"
      >
        <CircleAlertIcon />
        <AlertDescription>
          <Tooltip>
            <TooltipTrigger render={<div className="line-clamp-3" />}>{error}</TooltipTrigger>
            <TooltipPopup side="top" className="max-w-96 whitespace-pre-wrap">
              {error}
            </TooltipPopup>
          </Tooltip>
        </AlertDescription>
        {(onContinue || onDismiss) && (
          <AlertAction>
            {onContinue && (
              <Button variant="outline" size="xs" onClick={onContinue}>
                Write a follow-up
              </Button>
            )}
            {onDismiss && (
              <Button variant="ghost" size="icon-xs" aria-label="Dismiss error" onClick={onDismiss}>
                <XIcon className="text-destructive" />
              </Button>
            )}
          </AlertAction>
        )}
      </Alert>
    </div>
  );
});
