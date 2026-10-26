/**
 * The switchboard header row under search: Group by and Density.
 *
 * The trigger shows the rendered mode, which a stat filter or the project
 * scope can override without touching the saved one. Accessible names come
 * from the visible text (WCAG 2.5.3), so narrow columns hide the "Group by"
 * prefix visually but keep it in the name.
 */
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import {
  ChevronsUpDownIcon,
  CircleDotIcon,
  FolderIcon,
  GitBranchIcon,
  Rows2Icon,
  Rows3Icon,
  type LucideIcon,
} from "lucide-react";
import { useRef } from "react";

import { cn } from "~/lib/utils";
import type { SidebarGroupBy } from "../Sidebar.logic";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "../ui/menu";

export type SidebarDensity = "comfortable" | "compact";

const GROUP_BY_OPTIONS: readonly {
  value: SidebarGroupBy;
  label: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    value: "branch",
    label: "Branch",
    description: "Lanes per branch and worktree",
    icon: GitBranchIcon,
  },
  {
    value: "status",
    label: "Status",
    description: "Needs you, error, running, idle",
    icon: CircleDotIcon,
  },
  { value: "project", label: "Project", description: "One group per project", icon: FolderIcon },
];

const DENSITY_OPTIONS: readonly { value: SidebarDensity; label: string; icon: LucideIcon }[] = [
  { value: "comfortable", label: "Comfortable", icon: Rows2Icon },
  { value: "compact", label: "Compact", icon: Rows3Icon },
];

const OPEN_KEYS = new Set(["Enter", " ", "ArrowDown"]);

export function SidebarGroupByRow({
  groupBy,
  allProjects,
  onGroupByChange,
  density,
  onDensityChange,
}: {
  /** The rendered (effective) mode. */
  groupBy: SidebarGroupBy;
  /** Project grouping is only offered in the All projects scope. */
  allProjects: boolean;
  onGroupByChange: (groupBy: SidebarGroupBy) => void;
  density: SidebarDensity;
  onDensityChange: (density: SidebarDensity) => void;
}) {
  const options = allProjects
    ? GROUP_BY_OPTIONS
    : GROUP_BY_OPTIONS.filter((option) => option.value !== "project");
  const current = GROUP_BY_OPTIONS.find((option) => option.value === groupBy)!;
  const CurrentIcon = current.icon;
  // Keyboard opens land on the checked item. The menu highlights its first
  // item on open, so the first focus inside the popup is redirected once.
  const focusCheckedOnOpenRef = useRef(false);

  return (
    <div
      data-testid="sidebar-group-by-row"
      className="@container/sidebar-column flex h-8 items-center gap-1.5 px-2.5"
    >
      <Menu>
        <MenuTrigger
          onKeyDown={(event) => {
            if (OPEN_KEYS.has(event.key)) focusCheckedOnOpenRef.current = true;
          }}
          onPointerDown={() => {
            focusCheckedOnOpenRef.current = false;
          }}
          className="sb-action flex h-6 min-w-0 items-center gap-1 rounded-[5px] pr-1.5 pl-[5px] text-[11.5px] hover:bg-sb-hover data-popup-open:bg-sb-hover"
        >
          <CurrentIcon
            aria-hidden
            className="size-[13px] shrink-0 text-sb-muted"
            strokeWidth={1.75}
          />
          <span className="text-sb-muted @max-[280px]/sidebar-column:sr-only">Group by</span>{" "}
          <span className="truncate font-medium text-sb-foreground">{current.label}</span>
          <ChevronsUpDownIcon
            aria-hidden
            className="size-3 shrink-0 text-sb-muted"
            strokeWidth={1.75}
          />
        </MenuTrigger>
        <MenuPopup
          align="start"
          // Portaled to the body: the attribute brings the switchboard tokens along.
          data-switchboard="sidebar"
          className="w-[252px] rounded-[10px]"
          onFocusCapture={(event) => {
            if (!focusCheckedOnOpenRef.current) return;
            focusCheckedOnOpenRef.current = false;
            const checked = event.currentTarget.querySelector<HTMLElement>(
              '[role="menuitemradio"][aria-checked="true"]',
            );
            if (checked && checked !== event.target) checked.focus();
          }}
        >
          <MenuRadioGroup
            value={groupBy}
            onValueChange={(value) => onGroupByChange(value as SidebarGroupBy)}
          >
            {options.map((option) => {
              const Icon = option.icon;
              return (
                <MenuRadioItem
                  key={option.value}
                  value={option.value}
                  // One choice per open: picking a mode closes the menu.
                  closeOnClick
                  className="min-h-0 gap-0 rounded-md px-2 py-1.5"
                >
                  <span className="flex min-w-0 items-start gap-2">
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      <MenuRadioItemIndicator />
                    </span>
                    <Icon
                      aria-hidden
                      className="mt-px size-3.5 shrink-0 text-sb-muted"
                      strokeWidth={1.75}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[12.5px] leading-4 text-sb-foreground">
                        {option.label}
                      </span>
                      <span className="text-[11px] leading-4 text-sb-muted">
                        {option.description}
                      </span>
                    </span>
                  </span>
                </MenuRadioItem>
              );
            })}
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
      <RadioGroup
        aria-label="Density"
        value={density}
        onValueChange={(value) => onDensityChange(value as SidebarDensity)}
        className="ml-auto inline-flex shrink-0 rounded-md border border-sb-border p-px"
      >
        {DENSITY_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <Radio.Root
              key={option.value}
              value={option.value}
              aria-label={option.label}
              className={cn(
                "inline-flex h-[22px] w-6 cursor-pointer items-center justify-center rounded-[5px] text-sb-muted hover:text-sb-foreground",
                "data-checked:bg-sb-selection data-checked:text-sb-foreground data-checked:shadow-[inset_0_0_0_1px_var(--sb-accent)]",
              )}
            >
              <Icon aria-hidden className="size-3.5" strokeWidth={1.75} />
            </Radio.Root>
          );
        })}
      </RadioGroup>
    </div>
  );
}
