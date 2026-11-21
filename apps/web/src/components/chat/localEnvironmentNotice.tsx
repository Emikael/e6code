import type { EnvironmentId } from "@e6tools/contracts";
import { CircleAlertIcon, RotateCwIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { localEnvironmentNoticeCopy, type LocalEnvironmentWord } from "~/localEnvironmentWord";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

/**
 * The composer notice while the thread's environment is the desktop's local environment and it
 * is not ready. It takes the place of "is reconnecting" and has no actions: there is nothing to
 * reconnect to until the backend is up. This is where a keyboard user reads the reason.
 */
export function localEnvironmentNoticeItem(
  environmentId: EnvironmentId,
  word: LocalEnvironmentWord,
): ComposerBannerStackItem {
  const copy = localEnvironmentNoticeCopy(word);
  return {
    id: `environment-unavailable:${environmentId}`,
    variant: copy.variant,
    icon:
      copy.icon === "restart" ? (
        <RotateCwIcon />
      ) : copy.icon === "alert" ? (
        <CircleAlertIcon />
      ) : (
        <span className="size-1.5 rounded-full bg-foreground" aria-hidden="true" />
      ),
    title: copy.title,
    ...(copy.description === null && copy.reason === null
      ? {}
      : {
          description: (
            <>
              {copy.description}
              {copy.description !== null && copy.reason !== null ? " · " : null}
              {copy.reason === null ? null : (
                <span className={cn(copy.reason.mono && "font-mono text-[11px]")}>
                  {copy.reason.text}
                </span>
              )}
            </>
          ),
        }),
  };
}
