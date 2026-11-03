import { useState } from "react";
import { ArrowRightIcon, ChevronRightIcon } from "lucide-react";
import { type ModelSelection, ProviderInstanceId } from "@e6tools/contracts";
import { createModelSelection } from "@e6tools/shared/model";

import type { HandoffTargetOption } from "@e6tools/client-runtime/state/thread-handoff";
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
 * limited one. Reuses the Settings model + traits pickers; `resolveSelection`
 * validates a target's model and fills the user's last options for it.
 */
export function ThreadHandoffDialog(props: {
  readonly open: boolean;
  readonly sourceTitle: string;
  readonly targets: ReadonlyArray<HandoffTargetOption>;
  /** Picker entries for every target instance (the source is excluded). */
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  readonly planModeEnabled: boolean;
  readonly resolveSelection: (selection: {
    readonly instanceId: ProviderInstanceId;
    readonly model?: string;
  }) => ModelSelection | null;
  readonly preview: string;
  readonly busy?: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: (selection: ModelSelection) => void;
}) {
  const [picked, setPicked] = useState<ModelSelection | null>(null);
  // Every close path (Cancel, confirm, Escape) drops the pick so a reopen starts fresh.
  if (!props.open && picked !== null) setPicked(null);
  const isAvailable = (instanceId: string) =>
    props.targets.some((target) => target.instanceId === instanceId && target.available);
  const firstAvailable = props.targets.find((target) => target.available);
  const selection =
    (picked && isAvailable(picked.instanceId) ? picked : null) ??
    (firstAvailable
      ? props.resolveSelection({ instanceId: ProviderInstanceId.make(firstAvailable.instanceId) })
      : null);
  const selectedEntry =
    props.instanceEntries.find((entry) => entry.instanceId === selection?.instanceId) ?? null;
  const canStart = selection !== null && selectedEntry !== null;
  const limitedLabels = new Map(
    props.targets.filter((target) => !target.available).map((t) => [t.instanceId, t.label]),
  );
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && props.busy === true) return;
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
          {canStart ? (
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
                onInstanceModelChange={(instanceId, model) => {
                  // Re-picking the current model keeps its chosen effort.
                  if (instanceId === selection.instanceId && model === selection.model) return;
                  setPicked(props.resolveSelection({ instanceId, model }));
                }}
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
              {props.targets.length > 0
                ? "Every other provider has reached its usage limit."
                : "No other provider is available. Set one up in Settings › Providers."}
            </p>
          )}
          {props.preview ? (
            <Collapsible className="rounded-lg border bg-muted/40 px-3 py-2">
              <CollapsibleTrigger className="group flex items-center gap-1 text-muted-foreground text-xs">
                <ChevronRightIcon className="size-3.5 transition-transform group-data-panel-open:rotate-90" />
                What carries over
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs">
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
          {canStart ? (
            <Button
              type="button"
              disabled={props.busy === true}
              onClick={() => props.onConfirm(selection)}
            >
              {props.busy === true ? "Starting…" : "Start thread"}
              <ArrowRightIcon />
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
