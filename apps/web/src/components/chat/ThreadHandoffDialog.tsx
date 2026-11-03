import { useState } from "react";
import { ArrowRightIcon, ChevronRightIcon } from "lucide-react";
import { type ModelSelection, ProviderInstanceId } from "@e6tools/contracts";
import { createModelSelection } from "@e6tools/shared/model";

import type { HandoffTargetOption } from "@e6tools/client-runtime/state/thread-handoff";
import { useComposerDraftStore } from "../../composerDraftStore";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";
import { ProviderModelPicker } from "./ProviderModelPicker";
import type { ModelEsque } from "./providerIconUtils";
import { TraitsPicker } from "./TraitsPicker";

/**
 * Picks the provider, model and effort for a new thread continued from a
 * limited one. Reuses the Settings model + traits pickers; the starting
 * choice is the first available target with the user's last selection for it.
 */
export function ThreadHandoffDialog(props: {
  readonly open: boolean;
  readonly sourceTitle: string;
  readonly targets: ReadonlyArray<HandoffTargetOption>;
  /** Picker entries for every target instance (the source is excluded). */
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  readonly planModeEnabled: boolean;
  readonly preview: string;
  readonly busy?: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: (selection: ModelSelection) => void;
}) {
  const stickySelections = useComposerDraftStore((store) => store.stickyModelSelectionByProvider);
  const [picked, setPicked] = useState<ModelSelection | null>(null);
  // Resolve the default lazily and reset on close so another thread never reuses a stale choice.
  const selectionFor = (instanceId: ProviderInstanceId, model?: string): ModelSelection | null => {
    const sticky = stickySelections[instanceId];
    if (sticky && (model === undefined || sticky.model === model)) return sticky;
    const fallback = model ?? props.targets.find((t) => t.instanceId === instanceId)?.model;
    return fallback ? createModelSelection(instanceId, fallback) : null;
  };
  const firstAvailable = props.targets.find((target) => target.available);
  const selection =
    picked ??
    (firstAvailable ? selectionFor(ProviderInstanceId.make(firstAvailable.instanceId)) : null);
  const selectedEntry =
    props.instanceEntries.find((entry) => entry.instanceId === selection?.instanceId) ?? null;
  const limitedLabels = new Map(
    props.targets.filter((target) => !target.available).map((t) => [t.instanceId, t.label]),
  );
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) setPicked(null);
        props.onOpenChange(open);
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Continue in a new thread</DialogTitle>
          <DialogDescription>
            Starts a new thread from a summary of &ldquo;{props.sourceTitle}&rdquo;. This thread
            stays as it is.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-3">
          {selection && selectedEntry ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <ProviderModelPicker
                activeInstanceId={selection.instanceId}
                model={selection.model}
                lockedProvider={null}
                instanceEntries={props.instanceEntries}
                modelOptionsByInstance={props.modelOptionsByInstance}
                triggerVariant="outline"
                disabled={props.busy === true}
                getModelDisabledReason={(instanceId) => {
                  const label = limitedLabels.get(instanceId);
                  return label === undefined ? null : `${label} has reached its usage limit.`;
                }}
                onInstanceModelChange={(instanceId, model) =>
                  setPicked(selectionFor(instanceId, model))
                }
              />
              <TraitsPicker
                provider={selectedEntry.driverKind}
                instanceId={selection.instanceId}
                models={selectedEntry.models}
                model={selection.model}
                prompt=""
                onPromptChange={() => {}}
                modelOptions={selection.options ?? []}
                allowPromptInjectedEffort={false}
                planModeEnabled={props.planModeEnabled}
                triggerVariant="outline"
                onModelOptionsChange={(options) =>
                  setPicked(createModelSelection(selection.instanceId, selection.model, options))
                }
              />
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No other provider is available. Set one up in Settings › Providers.
            </p>
          )}
          {props.preview ? (
            <Collapsible className="rounded-lg border bg-muted/40 px-3 py-2">
              <CollapsibleTrigger className="group flex items-center gap-1 text-muted-foreground text-xs">
                <ChevronRightIcon className="size-3.5 transition-transform group-data-panel-open:rotate-90" />
                What carries over
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-sans text-xs">
                  {props.preview}
                </pre>
              </CollapsiblePanel>
            </Collapsible>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={props.busy === true}
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={selection === null || props.busy === true}
            onClick={() => {
              if (selection) props.onConfirm(selection);
            }}
          >
            {props.busy === true ? "Starting…" : "Start thread"}
            <ArrowRightIcon />
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
