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
  className,
}: {
  label: string | null;
  className?: string;
}) {
  if (!label) return null;
  const keys = shortcutLabelKeys(label);
  return (
    <KbdGroup aria-hidden className={cn("gap-0.5", className)}>
      {/* A shortcut names each key once, so the key text is unique. */}
      {keys.map((key) => (
        <Kbd
          key={key}
          className="h-5 min-w-5 rounded border border-b-2 border-border bg-card px-[5px] text-[11px] leading-[14px] text-muted-foreground"
        >
          {key}
        </Kbd>
      ))}
    </KbdGroup>
  );
}
