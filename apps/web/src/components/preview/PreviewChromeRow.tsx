import { RefreshIcon } from "~/components/ui/refresh-icon";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupInput } from "~/components/ui/input-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import { PanelSurfaceHeader } from "../panel/PanelSurfaceHeader";
import { addressFieldLabel } from "./previewEmptyStateLogic";

interface Props {
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  refreshDisabled: boolean;
  inputDisabled?: boolean | undefined;
  /** Bumping this value re-focuses and selects the URL input. */
  focusUrlNonce?: number | undefined;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onSubmit: (url: string) => void;
  /**
   * When provided, renders an annotation-mode toggle button to the right of
   * the URL input. Pressed while annotation mode is active (button shows in `pressed`
   * state). Disabled in `pickDisabled` mode.
   */
  onPickElement?: (() => void) | undefined;
  pickActive?: boolean | undefined;
  pickDisabled?: boolean | undefined;
  /** Optional reason string surfaced in the disabled tooltip. */
  pickDisabledReason?: string | undefined;
  /**
   * Trailing slot after Annotate: the More menu (screenshot, record, float over chat, open in
   * system browser, DevTools, device size, appearance, zoom, clear cookies).
   */
  trailingActions?: ReactNode;
  /**
   * Slot between the nav buttons and the URL input. The preview view uses it
   * to name the tab's browser profile, which is otherwise invisible.
   */
  leadingActions?: ReactNode;
}

const NOOP = () => {};

export function PreviewChromeRow({
  url,
  loading,
  canGoBack,
  canGoForward,
  refreshDisabled,
  inputDisabled,
  focusUrlNonce,
  onBack,
  onForward,
  onRefresh,
  onSubmit,
  onPickElement,
  pickActive,
  pickDisabled,
  pickDisabledReason,
  trailingActions,
  leadingActions,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(url);
  const [inputFocused, setInputFocused] = useState(false);

  useEffect(() => {
    if (focusUrlNonce == null) return;
    const node = inputRef.current;
    if (!node) return;
    node.focus();
  }, [focusUrlNonce]);

  const submit = (event?: FormEvent | KeyboardEvent) => {
    event?.preventDefault();
    const next = draft.trim();
    if (next.length === 0) return;
    onSubmit(next);
    inputRef.current?.blur();
  };

  return (
    <div className="relative">
      <PanelSurfaceHeader>
        {/* `contents` lets the form's controls sit in the header's own row. */}
        <form onSubmit={submit} className="contents">
          <div className="flex items-center gap-0.5" role="group" aria-label="Navigation">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="sm:size-7"
                    onClick={canGoBack ? onBack : NOOP}
                    disabled={!canGoBack}
                    aria-label="Back"
                    type="button"
                  />
                }
              >
                <ChevronLeft />
              </TooltipTrigger>
              <TooltipPopup>Back</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="sm:size-7"
                    onClick={canGoForward ? onForward : NOOP}
                    disabled={!canGoForward}
                    aria-label="Forward"
                    type="button"
                  />
                }
              >
                <ChevronRight />
              </TooltipTrigger>
              <TooltipPopup>Forward</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="sm:size-7"
                    onClick={refreshDisabled ? NOOP : onRefresh}
                    disabled={refreshDisabled}
                    aria-label={loading ? "Stop" : "Refresh"}
                    type="button"
                  />
                }
              >
                <RefreshIcon refreshing={loading} />
              </TooltipTrigger>
              <TooltipPopup>{loading ? "Loading…" : "Refresh"}</TooltipPopup>
            </Tooltip>
          </div>

          {leadingActions}

          {/* Board 17: the address field keeps a visible muted-foreground hairline. */}
          <InputGroup className="h-[30px] flex-1 border-muted-foreground bg-card shadow-none">
            <Tooltip>
              <TooltipTrigger
                render={
                  <InputGroupInput
                    ref={inputRef}
                    value={inputFocused ? draft : addressFieldLabel(url)}
                    className="font-mono text-xs sm:text-xs"
                    onChange={(event) => setDraft(event.target.value)}
                    onFocus={() => {
                      setDraft(url);
                      setInputFocused(true);
                      queueMicrotask(() => inputRef.current?.select());
                    }}
                    onBlur={() => {
                      setInputFocused(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submit(event);
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setDraft(url);
                        inputRef.current?.blur();
                      }
                    }}
                    placeholder="Search or enter URL"
                    spellCheck={false}
                    disabled={inputDisabled}
                    data-preview-url-input
                    size="sm"
                  />
                }
              />
            </Tooltip>
          </InputGroup>

          {onPickElement ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  // Pressed, the toggle takes the secondary fill and a primary-edge line (board 17).
                  <Button
                    variant="outline"
                    size="compact"
                    onClick={onPickElement}
                    disabled={pickDisabled}
                    aria-pressed={pickActive ? "true" : "false"}
                    type="button"
                    className={cn(
                      pickActive &&
                        "border-primary-edge bg-secondary shadow-[inset_0_0_0_1px_var(--primary-edge)] dark:bg-secondary [:hover,[data-pressed]]:bg-secondary dark:[:hover,[data-pressed]]:bg-secondary",
                    )}
                  />
                }
              >
                Annotate
              </TooltipTrigger>
              <TooltipPopup>
                {pickDisabled && pickDisabledReason
                  ? pickDisabledReason
                  : pickActive
                    ? "Finish annotating (Esc)"
                    : "Click an element or drag a region to note it for the agent"}
              </TooltipPopup>
            </Tooltip>
          ) : null}
          {trailingActions}
        </form>
      </PanelSurfaceHeader>
      <div
        aria-hidden
        data-loading={loading}
        className="preview-loading-progress pointer-events-none absolute bottom-0 left-0 z-10 h-0.5 w-full origin-left rounded-r-full bg-primary"
        style={{ boxShadow: "0 0 6px 1px var(--color-ring)" }}
      />
    </div>
  );
}
