import { useId, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { ChangedDot } from "./ChangedDot";
import { ResetButton } from "./ResetButton";

export function SettingRow({
  id,
  controlId,
  label,
  help,
  children,
  scope,
  changed = false,
  onReset,
  saving = false,
  saved = false,
  error,
  onRetry,
  warning,
  disabled = false,
  disabledReason,
  legacy = false,
  className,
}: {
  id?: string;
  controlId: string;
  label: ReactNode;
  help?: ReactNode;
  children: ReactNode;
  scope?: ReactNode;
  changed?: boolean;
  onReset?: () => void;
  saving?: boolean;
  saved?: boolean;
  error?: string;
  onRetry?: () => void;
  warning?: string;
  disabled?: boolean;
  disabledReason?: string;
  legacy?: boolean;
  className?: string;
}) {
  const labelId = useId();
  return (
    <div className="@container border-b border-sb-border last:border-b-0">
      <fieldset
        id={id}
        disabled={disabled}
        aria-labelledby={labelId}
        className={cn(
          "relative m-0 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-0 bg-sb-surface px-4 py-3 text-(length:--sb-text-body) text-sb-foreground focus-within:bg-sb-selection @min-[760px]:grid-cols-[minmax(0,1fr)_280px_minmax(0,9.5rem)_28px] [&_:disabled]:cursor-not-allowed [&_:disabled]:opacity-50",
          disabled && "cursor-not-allowed text-sb-muted",
          className,
        )}
      >
        <div className="col-span-2 min-w-0 @min-[760px]:col-span-1">
          {changed && <ChangedDot className="absolute top-5 left-1.5" />}
          <div className="flex items-center gap-2">
            <label id={labelId} htmlFor={controlId} className="font-medium">
              {label}
            </label>
            {legacy && (
              <span className="rounded-[5px] border border-sb-border px-1 text-(length:--sb-text-meta) text-sb-muted">
                legacy
              </span>
            )}
          </div>
          {help && <div className="mt-0.5 text-(length:--sb-text-meta) text-sb-muted">{help}</div>}
          {warning && (
            <p className="mt-1 text-(length:--sb-text-meta) text-(--state-approval)">{warning}</p>
          )}
          {disabled && disabledReason && (
            <p className="mt-1 text-(length:--sb-text-meta) text-sb-muted">{disabledReason}</p>
          )}
          <div role="status" className="text-(length:--sb-text-meta)">
            {error ? (
              <span className="text-(--state-error)">
                Couldn't save: {error}{" "}
                {onRetry && (
                  <Button variant="chip" className="sb-action px-1 py-0.5" onClick={onRetry}>
                    Retry
                  </Button>
                )}
              </span>
            ) : saving ? (
              <span className="text-sb-muted">Saving…</span>
            ) : saved ? (
              <span className="text-(--state-completed)">Saved</span>
            ) : null}
          </div>
        </div>
        <div className="col-span-2 min-w-0 @min-[760px]:col-span-1">{children}</div>
        <div className="min-w-0">{scope}</div>
        <div className="flex min-h-7 justify-end">
          {changed && onReset && <ResetButton onReset={onReset} disabled={disabled || saving} />}
        </div>
      </fieldset>
    </div>
  );
}
