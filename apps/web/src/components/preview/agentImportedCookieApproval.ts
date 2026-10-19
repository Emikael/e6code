import type { DesktopPreviewBridge } from "@e6tools/contracts";

/**
 * Asks the person at the desktop before an agent drives a tab whose partition
 * holds cookies imported from their real browser. The grant IPC is invoked
 * only after `confirm` resolves true — never from an agent or server call.
 */
export function agentImportedCookieApprovalMessage(input: {
  readonly browserName: string;
  readonly profileName: string;
}): string {
  return `Allow the agent to use cookies imported from ${input.browserName} in the ${input.profileName} profile for this tab? The agent will be able to act as you on sites you're signed into. You can revoke this from the preview. It ends when you quit the app.`;
}

export class AgentImportedCookieAccessDeniedError extends Error {
  constructor(browserName: string, profileName: string) {
    super(
      `The user denied agent access to cookies imported from ${browserName} in the ${profileName} profile.`,
    );
    this.name = "AgentImportedCookieAccessDeniedError";
  }
}

export async function ensureAgentImportedCookieAccess(input: {
  readonly bridge: Pick<
    DesktopPreviewBridge,
    "agentImportedCookieAccess" | "grantAgentImportedCookieAccess"
  >;
  readonly tabId: string;
  readonly environmentId?: string | undefined;
  readonly profileId?: string | undefined;
  readonly profileName: (profileId: string) => string;
  readonly confirm: (message: string) => Promise<boolean>;
}): Promise<void> {
  const access = await input.bridge.agentImportedCookieAccess(input.tabId, {
    ...(input.environmentId === undefined ? {} : { environmentId: input.environmentId }),
    ...(input.profileId === undefined ? {} : { profileId: input.profileId }),
  });
  if (!access.holdsImportedCookies || access.approved) return;
  const browserName = access.browserName ?? "your browser";
  const profileName =
    access.profileId === null ? "this profile" : input.profileName(access.profileId);
  const confirmed = await input.confirm(
    agentImportedCookieApprovalMessage({ browserName, profileName }),
  );
  if (!confirmed) {
    throw new AgentImportedCookieAccessDeniedError(browserName, profileName);
  }
  await input.bridge.grantAgentImportedCookieAccess(input.tabId);
}
