import { lazy, Suspense } from "react";

import { hasCloudPublicConfig } from "~/cloud/publicConfig";

// Clerk stays out of the startup graph. Local sessions never download it, and
// a hosted session only fetches the wizard after the shell has painted.
const ConfiguredConnectOnboardingDialog = lazy(() =>
  import("./ConnectOnboardingDialogConfigured").then((module) => ({
    default: module.ConfiguredConnectOnboardingDialog,
  })),
);

/**
 * Post-sign-in onboarding wizard for E6 Connect. Opens on every in-session
 * sign-in — sign-out removes the connected relay environments, so each new
 * session starts with no devices to reach. It first prompts to publish this
 * environment (managed tunnel + agent activity, both defaulting on) when the
 * current session is authorized to manage the relay link, then lists the
 * account's E6 Connect environments so every device can be connected right
 * away. A cold load with a restored session does not count as a sign-in.
 */
export function ConnectOnboardingDialog() {
  if (!hasCloudPublicConfig()) return null;

  return (
    <Suspense fallback={null}>
      <ConfiguredConnectOnboardingDialog />
    </Suspense>
  );
}
