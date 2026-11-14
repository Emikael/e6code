import type { EnvironmentId, ScopedThreadRef } from "@e6tools/contracts";
import { Clock, X } from "lucide-react";
import { Fragment } from "react";

import type { BrowserHistoryEntry } from "~/browserHistoryStore";
import { Button } from "~/components/ui/button";

import { useDiscoveredLocalServers, type PreviewableServer } from "./useDiscoveredLocalServers";

interface Props {
  threadRef: ScopedThreadRef;
  environmentId: EnvironmentId;
  configuredUrls?: ReadonlyArray<string> | undefined;
  recentEntries: ReadonlyArray<BrowserHistoryEntry>;
  onRemoveRecent: (url: string) => void;
  onOpenUrl: (url: string) => void;
}

/** "localhost:5733/pull-requests": the address without its scheme or a bare trailing slash. */
function addressLabel(url: string): string {
  const parsed = new URL(url);
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  return `${parsed.host}${path}${parsed.search}${parsed.hash}`;
}

function serverName(server: PreviewableServer): string {
  return server.processName ?? "Local server";
}

/**
 * Board 17: "Nothing open", then the running local servers with their name and address, then
 * recent addresses. The first server's Open is the screen's one outlined button; every row's
 * actions are always visible, never only on hover.
 */
export function PreviewEmptyState({
  environmentId,
  configuredUrls,
  recentEntries,
  onRemoveRecent,
  onOpenUrl,
}: Props) {
  const servers = useDiscoveredLocalServers({
    environmentId,
    configuredUrls,
  });
  const recents = recentEntries.filter((entry) => URL.canParse(entry.url)).slice(0, 8);
  const rows = [
    ...servers.map((server, index) => (
      <div
        key={`server:${server.host}:${server.port}`}
        className="flex min-h-10 items-center gap-2.5"
      >
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-foreground" />
        <span className="shrink-0 font-medium text-[13px]">{serverName(server)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground tabular-nums leading-[14px]">
          {`${server.host}:${server.port}`}
        </span>
        <span className="shrink-0 font-medium text-foreground text-xs">Running</span>
        <Button
          size="compact"
          variant={index === 0 ? "outline" : "ghost"}
          aria-label={`Open ${serverName(server)}`}
          onClick={() => onOpenUrl(server.requestedUrl)}
        >
          Open
        </Button>
      </div>
    )),
    ...recents.map((entry) => {
      const label = addressLabel(entry.url);
      return (
        <div key={`recent:${entry.url}`} className="flex min-h-10 items-center gap-2.5">
          <Clock aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0 font-medium text-[13px]">Recent</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground tabular-nums leading-[14px]">
            {label}
          </span>
          <Button
            size="compact"
            variant="ghost"
            aria-label={`Open ${label}`}
            onClick={() => onOpenUrl(entry.url)}
          >
            Open
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Remove ${label} from recent addresses`}
            onClick={() => onRemoveRecent(entry.url)}
          >
            <X aria-hidden className="size-3.5" />
          </Button>
        </div>
      );
    }),
  ];

  return (
    <div className="flex h-full min-h-0 overflow-y-auto bg-sidebar">
      <section aria-label="Nothing open" className="flex w-full flex-col gap-3 p-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-semibold text-sm leading-5">Nothing open</h2>
          <p className="text-muted-foreground text-xs">
            {rows.length > 0
              ? "Pick a running server or type an address."
              : "Type an address above, or run a dev server. Running local servers show up here."}
          </p>
        </div>
        {rows.length > 0 ? (
          <div className="flex flex-col rounded-xl border border-border bg-surface-raised px-3 py-1">
            {rows.map((row, index) => (
              <Fragment key={row.key}>
                {index > 0 ? <div aria-hidden className="h-px bg-border" /> : null}
                {row}
              </Fragment>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
