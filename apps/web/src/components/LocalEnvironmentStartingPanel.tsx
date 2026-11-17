import { useAtomValue } from "@effect/atom-react";

import { cn } from "~/lib/utils";
import { localEnvironmentStatusAtom } from "../localEnvironmentStatus";
import {
  localEnvironmentPanelCopy,
  localEnvironmentWordAtom,
  type LocalEnvironmentPanelCopy,
  type LocalEnvironmentPanelPlacement,
} from "../localEnvironmentWord";
import { E6Monogram } from "./E6Monogram";
import { Empty } from "./ui/empty";
import { SidebarInset } from "./ui/sidebar";

/**
 * What the window shows while the desktop's local environment starts and there is nothing local
 * to show yet. `window` continues the boot shell on first run: the same tile in the same place,
 * now with words. `stage` stands in for the main area of the app shell. Static; nothing in it is
 * focusable, so native menus and Quit keep working.
 */
export function LocalEnvironmentStartingPanel({
  placement,
}: {
  readonly placement: LocalEnvironmentPanelPlacement;
}) {
  const label = useAtomValue(localEnvironmentStatusAtom)?.label ?? null;
  const word = useAtomValue(localEnvironmentWordAtom);
  const copy = localEnvironmentPanelCopy(word, { placement, label });

  if (placement === "stage") {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <Empty className="flex-1">
          <PanelText copy={copy} />
        </Empty>
      </SidebarInset>
    );
  }

  return (
    // Like #boot-shell it has no background of its own: body keeps the boot colour, and a
    // stored theme's boot background applies here as it does there.
    <main className="relative grid h-dvh min-h-0 grid-rows-[1fr_auto_1fr] justify-items-center px-6 text-foreground in-[html[data-theme-selected=true]]:bg-(--boot-background)">
      <div
        aria-hidden
        className="drag-region absolute inset-x-0 top-0 h-(--workspace-topbar-height)"
      />
      {/* The boot tile's graphite band and no ring, so the handoff from the boot shell only adds words. */}
      <E6Monogram className="row-start-2 size-16 [--mark-band:var(--boot-mark-band,var(--brand-graphite))] dark:after:ring-0" />
      <div className="row-start-3 pt-6">
        <PanelText copy={copy} />
      </div>
    </main>
  );
}

function PanelText({ copy }: { readonly copy: LocalEnvironmentPanelCopy }) {
  return (
    <div className="flex max-w-sm flex-col items-center text-center">
      <div role="status" aria-live="polite">
        <h1 className="text-lg font-semibold">{copy.title}</h1>
        {copy.lines.map((line) => (
          <p key={line} className="mt-2 text-sm text-muted-foreground">
            {line}
          </p>
        ))}
      </div>
      {copy.attempt === null ? null : (
        <p className="mt-2 text-sm text-muted-foreground">{copy.attempt}</p>
      )}
      {copy.reason === null ? null : (
        <p
          className={cn(
            "mt-2 select-text text-muted-foreground [overflow-wrap:anywhere]",
            copy.reason.mono ? "font-mono text-xs" : "text-sm",
          )}
        >
          {copy.reason.text}
        </p>
      )}
    </div>
  );
}
