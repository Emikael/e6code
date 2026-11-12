import type { ReactNode } from "react";

import { Button } from "../ui/button";
import type {
  PullRequestNextStep,
  PullRequestNextStepAction,
  PullRequestNextStepActionKind,
} from "./pullRequestDetail.logic";

/**
 * The next step card at the top of Summary (board 13): what is next, what it costs, one primary
 * action and at most one secondary. Its border is neutral; the failure it names is said here once.
 */
export function PullRequestNextStepCard({
  step,
  pending,
  onAction,
  renderAction,
}: {
  step: PullRequestNextStep;
  /** An action of the card is under way, so its buttons wait. */
  pending: boolean;
  onAction: (kind: PullRequestNextStepActionKind) => void;
  /** An action that is not a plain button, such as Request review opening the reviewer picker. */
  renderAction?: (action: PullRequestNextStepAction, primary: boolean) => ReactNode | undefined;
}) {
  const button = (action: PullRequestNextStepAction, primary: boolean) =>
    renderAction?.(action, primary) ?? (
      <Button
        key={action.kind}
        variant={primary ? "default" : "outline"}
        disabled={pending}
        onClick={() => onAction(action.kind)}
      >
        {action.label}
      </Button>
    );
  return (
    <section
      aria-label="Next step"
      className="flex flex-col gap-2.5 rounded-xl border border-border bg-card px-4 py-3.5"
    >
      <h2 className="text-sm font-semibold">{step.title}</h2>
      {step.body ? <p className="text-sm text-muted-foreground">{step.body}</p> : null}
      {step.primary || step.secondary ? (
        <div className="flex flex-wrap items-center gap-2">
          {step.primary ? button(step.primary, true) : null}
          {step.secondary ? button(step.secondary, false) : null}
        </div>
      ) : null}
      {step.caption ? <p className="text-xs text-muted-foreground">{step.caption}</p> : null}
    </section>
  );
}
