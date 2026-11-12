/**
 * "What changed, shown once" (board 7, F13): the start-screen notice for people
 * who used E6 Code before the attention redesign. It is the only place they
 * learn that notifications for blocked agents are now on, so it says so and
 * how to turn them off. Review settings and Got it both retire it for good.
 */
import { useRouter } from "@tanstack/react-router";
import { useMemo } from "react";

import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { useThreadShells } from "~/state/entities";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { offersNewLook, shouldShowWhatChanged } from "./WhatChangedCard.logic";

export function useWhatChangedVisible(): boolean {
  const dismissed = useClientSettings((settings) => settings.attentionIntroDismissed);
  const threads = useThreadShells();
  return useMemo(() => shouldShowWhatChanged({ dismissed, threads }), [dismissed, threads]);
}

export function WhatChangedCard() {
  const router = useRouter();
  const updateSettings = useUpdateClientSettings();
  const stockAccent = useClientSettings((settings) => settings.stockAccent);
  const appearanceContrast = useClientSettings((settings) => settings.appearanceContrast);
  const dismiss = () => updateSettings({ attentionIntroDismissed: true });
  const tryNewLook = () => {
    const previous = { stockAccent, appearanceContrast };
    updateSettings({ stockAccent: "graphite", appearanceContrast: 120 });
    toastManager.add({
      type: "success",
      title: "New look on",
      description: "Change it any time in Settings, Appearance.",
      actionProps: { children: "Undo", onClick: () => updateSettings(previous) },
    });
  };
  return (
    <section
      aria-label="What changed"
      className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface-raised px-4 py-3.5"
    >
      <p className="text-[13px] leading-[18px] font-medium text-foreground">
        E6 Code now puts what needs you first
      </p>
      <ul className="flex list-disc flex-col gap-1 ps-[18px] text-sm leading-[22px] text-foreground">
        <li>Blocked agents sit at the top of the sidebar.</li>
        <li>
          You get a notification when an agent is blocked, or when a thread you are waiting on
          finishes. You can turn this off in Settings, Attention.
        </li>
        <li>Opening a thread that changed shows where you left off.</li>
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="sm:text-xs"
          onClick={() => {
            dismiss();
            void router.navigate({ to: "/settings/attention" });
          }}
        >
          Review settings
        </Button>
        {offersNewLook({ stockAccent, appearanceContrast }) ? (
          <Button size="sm" variant="ghost" className="sm:text-xs" onClick={tryNewLook}>
            Try the new look
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" className="sm:text-xs" onClick={dismiss}>
          Got it
        </Button>
      </div>
    </section>
  );
}
