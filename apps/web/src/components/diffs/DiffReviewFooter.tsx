import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";

interface FooterAction {
  readonly label: string;
  readonly onClick: () => void;
}

/**
 * The review footer under a diff: where the reader is, then Reply (which only moves focus to the
 * composer; nothing is sent from here) and the one filled button, which follows the paging key.
 * While the composer holds text, Send owns the screen's one fill, so the primary turns outline.
 */
export function DiffReviewFooter(props: {
  readonly position: string;
  readonly reply: FooterAction | null;
  readonly primary: (FooterAction & { readonly shortcut?: string | null }) | null;
  readonly primaryOutline: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card px-3 py-2.5">
      <span className="min-w-0 flex-1 basis-[200px] font-medium text-[13px] tabular-nums leading-[18px]">
        {props.position}
      </span>
      {props.reply ? (
        <Button
          variant="outline"
          className="text-[13px] sm:text-[13px]"
          onClick={props.reply.onClick}
        >
          {props.reply.label}
        </Button>
      ) : null}
      {props.primary ? (
        <Button
          variant={props.primaryOutline ? "outline" : "default"}
          className="text-[13px] sm:text-[13px]"
          onClick={props.primary.onClick}
        >
          {props.primary.label}
          {props.primary.shortcut ? (
            <Kbd
              className={
                props.primaryOutline
                  ? "h-[18px] min-w-[18px] border border-border bg-transparent"
                  : "h-[18px] min-w-[18px] border border-primary-foreground bg-transparent text-primary-foreground"
              }
            >
              {props.primary.shortcut}
            </Kbd>
          ) : null}
        </Button>
      ) : null}
    </div>
  );
}

/** The paging keys, at the foot of the file rail: "V next change, J K files". */
export function DiffRailKeyHint(props: {
  readonly nextChange: string | null;
  readonly nextFile: string | null;
  readonly previousFile: string | null;
}) {
  if (!props.nextChange && !props.nextFile && !props.previousFile) return null;
  const key = (label: string) => (
    <Kbd className="border border-border border-b-2 bg-card text-[11px]">{label}</Kbd>
  );
  return (
    <p className="flex shrink-0 flex-wrap items-center gap-1.5 p-2 text-muted-foreground text-xs">
      {props.nextChange ? (
        <>
          {key(props.nextChange)}
          <span className="me-1">next change</span>
        </>
      ) : null}
      {props.nextFile ? key(props.nextFile) : null}
      {props.previousFile ? key(props.previousFile) : null}
      {props.nextFile || props.previousFile ? <span>files</span> : null}
    </p>
  );
}
