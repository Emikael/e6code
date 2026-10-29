import type { RuntimeMode } from "@e6tools/contracts";

import { MenuGroup, MenuRadioGroup, MenuRadioItem } from "../ui/menu";
import { runtimeModeConfig, runtimeModeOptions } from "./runtimeModeConfig";

/**
 * Permissions as a section of the effort menu, used while a thread runs on its default mode so the
 * footer does not spend a chip on it.
 */
export function ComposerPermissionsMenuSection(props: {
  runtimeMode: RuntimeMode;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  return (
    <MenuGroup>
      <div className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">Permissions</div>
      <MenuRadioGroup
        value={props.runtimeMode}
        onValueChange={(value) => props.onRuntimeModeChange(value as RuntimeMode)}
      >
        {runtimeModeOptions.map((mode) => {
          const option = runtimeModeConfig[mode];
          const OptionIcon = option.icon;
          return (
            <MenuRadioItem key={mode} value={mode} hideIndicator closeOnClick>
              <span className="flex w-full min-w-0 flex-col">
                <span className="inline-flex items-center gap-1.5">
                  <OptionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  {option.label}
                </span>
                <span className="max-w-56 text-pretty text-muted-foreground/80 text-xs">
                  {option.description}
                </span>
              </span>
            </MenuRadioItem>
          );
        })}
      </MenuRadioGroup>
    </MenuGroup>
  );
}
