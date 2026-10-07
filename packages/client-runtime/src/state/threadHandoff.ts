import type {
  ProviderInteractionMode,
  RuntimeMode,
  ServerProviderUsageLimits,
} from "@e6tools/contracts";

const LIMIT_PATTERN =
  /rate[\s_-]*limit|usage[\s_-]*limit|limit[\s_-]*reached|quota|429|too many requests/i;

export interface HandoffMessage {
  readonly role: "user" | "assistant" | "system" | "reasoning";
  readonly text: string;
  readonly createdAt: string;
}

export interface HandoffSource {
  readonly id: string;
  readonly title: string;
  readonly branch: string | null;
  readonly modelLabel: string;
  readonly messages: ReadonlyArray<HandoffMessage>;
}

export function isLimitErrorText(text: string | null | undefined): boolean {
  if (!text) return false;
  return LIMIT_PATTERN.test(text);
}

// ponytail: full window (100%) = exhausted; near-full stays available until provider says so
export function isProviderExhausted(limits: ServerProviderUsageLimits | undefined): boolean {
  if (!limits) return false;
  return limits.windows.some((window) => window.usedPercent >= 100);
}

export function shouldOfferHandoff(args: {
  readonly sessionLastError: string | null | undefined;
  readonly usageLimits: ServerProviderUsageLimits | undefined;
}): boolean {
  return isLimitErrorText(args.sessionLastError) || isProviderExhausted(args.usageLimits);
}

export interface HandoffProviderSnapshot {
  readonly instanceId: string;
  readonly model: string;
  readonly label: string;
  readonly usedPercent: number | undefined;
}

export interface HandoffTargetOption extends HandoffProviderSnapshot {
  readonly available: boolean;
}

/** Every non-source provider as a picker option: available ones first, limited ones flagged. */
export function buildHandoffTargets(
  providers: ReadonlyArray<HandoffProviderSnapshot>,
  excludeInstanceId: string,
): ReadonlyArray<HandoffTargetOption> {
  return providers
    .filter((provider) => provider.instanceId !== excludeInstanceId)
    .map((provider) => ({
      ...provider,
      available: provider.usedPercent === undefined || provider.usedPercent < 100,
    }))
    .sort((left, right) => Number(right.available) - Number(left.available));
}

export function firstAvailableHandoffTarget(
  providers: ReadonlyArray<HandoffProviderSnapshot>,
  excludeInstanceId: string,
): HandoffTargetOption | null {
  return (
    buildHandoffTargets(providers, excludeInstanceId).find((target) => target.available) ?? null
  );
}

function truncate(text: string, max = 500): string {
  const clean = text.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

export interface HandoffTurnSource {
  readonly projectId: string;
  readonly title: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

export interface HandoffTarget {
  readonly instanceId: string;
  readonly model: string;
}

export function buildHandoffTurnInput<
  TThreadId extends string = string,
  TMessageId extends string = string,
  TProjectId extends string = string,
  TInstanceId extends string = string,
>(args: {
  readonly source: Omit<HandoffTurnSource, "projectId"> & { readonly projectId: TProjectId };
  readonly handoffMarkdown: string;
  readonly target: Omit<HandoffTarget, "instanceId"> & { readonly instanceId: TInstanceId };
  readonly ids: {
    readonly threadId: TThreadId;
    readonly commandId: string;
    readonly messageId: TMessageId;
    readonly createdAt: string;
  };
}) {
  const title = `Continue: ${args.source.title}`.slice(0, 72);
  void args.ids.commandId;
  return {
    threadId: args.ids.threadId,
    message: {
      messageId: args.ids.messageId,
      role: "user" as const,
      text: args.handoffMarkdown,
      attachments: [],
    },
    modelSelection: { instanceId: args.target.instanceId, model: args.target.model },
    titleSeed: title,
    runtimeMode: args.source.runtimeMode,
    interactionMode: args.source.interactionMode,
    bootstrap: {
      createThread: {
        projectId: args.source.projectId,
        title,
        modelSelection: { instanceId: args.target.instanceId, model: args.target.model },
        runtimeMode: args.source.runtimeMode,
        interactionMode: args.source.interactionMode,
        branch: args.source.branch,
        worktreePath: args.source.worktreePath,
        createdAt: args.ids.createdAt,
      },
    },
    createdAt: args.ids.createdAt,
  };
}

export function buildHandoffDocument(
  source: HandoffSource,
  options: { readonly recentCount?: number } = {},
): { readonly markdown: string; readonly recent: ReadonlyArray<HandoffMessage> } {
  const recentCount = Math.max(0, options.recentCount ?? 10);
  const recent = recentCount === 0 ? [] : source.messages.slice(-recentCount);
  const goal = source.messages.find((message) => message.role === "user")?.text ?? source.title;
  const lines = [
    `Continuing from "${source.title}" (${source.modelLabel}).`,
    ``,
    `Goal: ${truncate(goal)}`,
  ];
  if (source.branch) lines.push(`Branch: ${source.branch}`);
  for (const message of recent) {
    lines.push(``, `> [${message.role}] ${truncate(message.text, 800)}`);
  }
  return { markdown: lines.join("\n"), recent };
}
