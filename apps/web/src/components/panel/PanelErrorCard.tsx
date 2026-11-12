import { CircleAlertIcon } from "lucide-react";

import { Button } from "../ui/button";

/** Ends a reason with a full stop so the reassurance after it reads as its own sentence. */
function asSentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * The panel's error pattern (board 14): what failed, with its icon and word; the reason and a line
 * that says what is safe; then Retry.
 */
export function PanelErrorCard(props: {
  title: string;
  reason: string;
  /** What the failure did not touch, such as "Your changes are not affected." */
  reassurance: string;
  onRetry?: (() => void) | undefined;
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-xl border border-error-foreground bg-surface-raised px-4 py-3.5"
    >
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-error-foreground">
        <CircleAlertIcon aria-hidden className="size-3.5 shrink-0" />
        {props.title}
      </span>
      <p className="text-sm text-muted-foreground">
        {asSentence(props.reason)} {props.reassurance}
      </p>
      {props.onRetry ? (
        <div className="flex items-center">
          <Button variant="outline" size="xs" disabled={props.retrying} onClick={props.onRetry}>
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}
