/**
 * "What changed, shown once" (board 7, F13): the start-screen notice for people
 * who used E6 Code before the attention redesign. It is the only place they
 * learn that notifications for blocked agents are now on, so it says so, and
 * Review settings opens where to turn them off. Review settings and Got it
 * both retire it for good. The new look stays in Settings, Appearance.
 */
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import {
  clientSettingsExistedBeforeLoad,
  useClientSettings,
  useClientSettingsHydrated,
  useUpdateClientSettings,
} from "~/hooks/useSettings";
import { useAllEnvironmentShellsBootstrapped, useThreadShells } from "~/state/entities";
import { Button } from "../ui/button";
import { decideAttentionIntro, shouldShowWhatChanged } from "./WhatChangedCard.logic";

export function useWhatChangedVisible(): boolean {
  const dismissed = useClientSettings((settings) => settings.attentionIntroDismissed);
  return shouldShowWhatChanged({ dismissed });
}

/**
 * Decides once, at the app root, whether this profile is one that used E6 Code
 * before the redesign, and stores the answer. Renders nothing.
 */
export function AttentionIntroDecision() {
  const decided = useClientSettings((settings) => settings.attentionIntroDismissed);
  const hydrated = useClientSettingsHydrated();
  // Once decided, nothing here subscribes to threads again.
  return hydrated && decided === undefined ? <PendingAttentionIntroDecision /> : null;
}

function PendingAttentionIntroDecision() {
  const threadsLoaded = useAllEnvironmentShellsBootstrapped();
  const threadCount = useThreadShells().length;
  const updateSettings = useUpdateClientSettings();
  useEffect(() => {
    const decision = decideAttentionIntro({
      decided: undefined,
      storedSettingsExisted: clientSettingsExistedBeforeLoad(),
      threadsLoaded,
      threadCount,
    });
    if (decision) updateSettings(decision);
  }, [threadsLoaded, threadCount, updateSettings]);
  return null;
}

export function WhatChangedCard() {
  const router = useRouter();
  const updateSettings = useUpdateClientSettings();
  const dismiss = () => updateSettings({ attentionIntroDismissed: true });
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
          finishes.
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
        <Button size="sm" variant="ghost" className="sm:text-xs" onClick={dismiss}>
          Got it
        </Button>
      </div>
    </section>
  );
}
