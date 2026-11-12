import type { ReactNode } from "react";

/**
 * The panel's empty pattern (board 14): a raised card that names what is missing, says why or
 * what will fill it, then offers at most an outline and a ghost action.
 */
export function PanelEmptyCard(props: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-raised px-4 py-3.5">
      <p className="text-[13px] font-medium">{props.title}</p>
      <p className="text-sm text-muted-foreground">{props.children}</p>
      {props.actions ? (
        <div className="flex flex-wrap items-center gap-2">{props.actions}</div>
      ) : null}
    </div>
  );
}
