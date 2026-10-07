import { useState } from "react";
import { ArrowRightIcon, GaugeIcon } from "lucide-react";

import type { HandoffTargetOption } from "@e6tools/client-runtime/state/thread-handoff";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";
import { cn } from "~/lib/utils";

export function ThreadHandoffDialog(props: {
  readonly open: boolean;
  readonly sourceTitle: string;
  readonly sourceLabel: string;
  readonly targets: ReadonlyArray<HandoffTargetOption>;
  readonly preview: string;
  readonly busy?: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: (target: HandoffTargetOption) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Default to the first available target until the user picks one; the id
  // resets on close so opening for another thread cannot reuse a stale choice.
  const effectiveSelectedId =
    selectedId ?? props.targets.find((target) => target.available)?.instanceId ?? null;
  const selected =
    props.targets.find((target) => target.instanceId === effectiveSelectedId) ?? null;
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) setSelectedId(null);
        props.onOpenChange(open);
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Continue with another provider</DialogTitle>
          <DialogDescription>
            Start a new linked session from &ldquo;{props.sourceTitle}&rdquo; ({props.sourceLabel}).
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-3">
          <div role="radiogroup" aria-label="Target provider" className="flex flex-col gap-1">
            {props.targets.length === 0 ? (
              <p className="text-muted-foreground text-sm">No other provider is configured.</p>
            ) : null}
            {props.targets.map((target) => (
              <button
                key={target.instanceId}
                type="button"
                role="radio"
                aria-checked={target.instanceId === effectiveSelectedId}
                disabled={!target.available}
                onClick={() => setSelectedId(target.instanceId)}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-start text-sm",
                  target.instanceId === effectiveSelectedId
                    ? "border-foreground/30 bg-accent"
                    : "border-transparent hover:bg-accent/50",
                  !target.available && "cursor-not-allowed opacity-60",
                )}
              >
                <span className="truncate font-medium">{target.label}</span>
                <span className="flex items-center gap-1 text-muted-foreground text-xs">
                  {target.available ? (
                    target.model
                  ) : (
                    <>
                      <GaugeIcon className="size-3.5" /> limited
                    </>
                  )}
                </span>
              </button>
            ))}
          </div>
          {props.preview ? (
            <details className="rounded-lg border bg-muted/40 px-3 py-2">
              <summary className="cursor-pointer text-muted-foreground text-xs">
                What will be carried over
              </summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-sans text-xs">
                {props.preview}
              </pre>
            </details>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={selected === null || props.busy === true}
            onClick={() => {
              if (selected) props.onConfirm(selected);
            }}
          >
            {props.busy === true ? "Starting…" : "Start new session"}
            <ArrowRightIcon />
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
