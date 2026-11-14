import { shortcutLabelKeys } from "../keybindings";
import { cn } from "../lib/utils";
import { Kbd, KbdGroup } from "./ui/kbd";

/**
 * A shortcut drawn as one key cap per key ("⌘ ⌥ N"), as the attention boards
 * draw hints beside a control. Hidden from assistive tech: the control's own
 * name carries the action, and the caps would read as stray symbols.
 */
export function ShortcutKeyCaps({
  label,
  compact = false,
  className,
}: {
  label: string | null;
  /**
   * For a hint inside a narrow control, such as New thread in the 264px sidebar: Shift draws as
   * ⇧ on every platform and each cap keeps 3px beside its key instead of 5px, so "Ctrl ⇧ O"
   * fits where "Ctrl Shift O" did not.
   */
  compact?: boolean;
  className?: string;
}) {
  if (!label) return null;
  const keys = shortcutLabelKeys(label, { compactModifiers: compact });
  return (
    <KbdGroup aria-hidden className={cn("gap-0.5", className)}>
      {/* A shortcut names each key once, so the key text is unique. */}
      {keys.map((key) => (
        <Kbd
          key={key}
          className={cn(
            "h-5 min-w-5 rounded border border-b-2 border-border bg-card text-[11px] leading-[14px] text-muted-foreground",
            compact ? "px-[3px]" : "px-[5px]",
          )}
        >
          {key}
        </Kbd>
      ))}
    </KbdGroup>
  );
}
