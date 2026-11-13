/**
 * "Done today" in the sidebar footer (boards 1 and 5, F9). It carries no
 * number: what got done is a list to look at, not a score.
 */
import { CheckIcon } from "lucide-react";
import { memo } from "react";

import { openDoneToday } from "../DoneTodayDialog";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { SIDEBAR_NAV_ROW_CLASS } from "./sidebarNavRow";

export const SidebarDoneToday = memo(function SidebarDoneToday() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton onClick={openDoneToday} className={SIDEBAR_NAV_ROW_CLASS}>
          <CheckIcon />
          <span className="min-w-0 flex-1 truncate">Done today</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
});
