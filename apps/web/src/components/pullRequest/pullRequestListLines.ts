import type { ThreadPullRequestLink } from "@e6tools/contracts";
import type { ThreadPullRequestChain } from "@e6tools/shared/threadPullRequests";

/** One line of a thread's pull-request list: a link plus how deep it sits in its stack. */
export interface PullRequestListLine {
  readonly link: ThreadPullRequestLink;
  /** 0 for a pull request on the base branch; each layer above steps in by one. */
  readonly depth: number;
  /** Which chain the line belongs to, so callers can tell one stack's lines from another's. */
  readonly chainKey: string;
  /** Set on the bottom layer of a multi-layer stack, so that row can name the whole stack. */
  readonly stack: { readonly kind: ThreadPullRequestChain["kind"]; readonly size: number } | null;
}

function activityAt(link: ThreadPullRequestLink): number {
  const ms = Date.parse(link.snapshot?.updatedAt ?? link.linkedAt);
  return Number.isNaN(ms) ? 0 : ms;
}

function chainKeyOf(chain: ThreadPullRequestChain): string {
  const bottom = chain.layers[0]!;
  return `${bottom.host}/${bottom.repository}#${bottom.number}`;
}

/**
 * Flattens chains into indented lines, newest first. A stack sorts by its most recent layer and
 * then reads bottom to top beneath that slot, so the layer you would review first is at the
 * bottom of the indent and a fresh push anywhere in the stack floats the whole stack up.
 */
export function pullRequestListLines(
  chains: ReadonlyArray<ThreadPullRequestChain>,
): ReadonlyArray<PullRequestListLine> {
  const ordered = [...chains].sort(
    (left, right) =>
      Math.max(...right.layers.map(activityAt)) - Math.max(...left.layers.map(activityAt)),
  );
  return ordered.flatMap((chain) => {
    const chainKey = chainKeyOf(chain);
    return chain.layers.map((link, depth) => ({
      link,
      depth,
      chainKey,
      stack:
        depth === 0 && chain.layers.length > 1
          ? { kind: chain.kind, size: chain.layers.length }
          : null,
    }));
  });
}

/** One status of a linked pull request, said as a word; `tone` marks the ones that need you. */
export interface PullRequestRowWord {
  readonly text: string;
  readonly tone: "muted" | "failed" | "merged";
}

/**
 * What a thread's linked pull request row says under its title (board 14): its state, then for an
 * open one how its checks and review stand, each in words. A host that reported nothing about
 * checks or review leaves that word out rather than guessing.
 */
export function threadPullRequestRowWords(
  snapshot: NonNullable<ThreadPullRequestLink["snapshot"]>,
): PullRequestRowWord[] {
  if (snapshot.state === "merged") return [{ text: "Merged", tone: "merged" }];
  if (snapshot.state === "closed") return [{ text: "Closed", tone: "muted" }];
  const words: PullRequestRowWord[] = [
    { text: snapshot.isDraft ? "Draft" : "Open", tone: "muted" },
  ];
  if (snapshot.mergeability === "conflicting") words.push({ text: "Conflicts", tone: "failed" });
  if (snapshot.checksState === "failing") words.push({ text: "Checks failing", tone: "failed" });
  else if (snapshot.checksState === "pending")
    words.push({ text: "Checks running", tone: "muted" });
  else if (snapshot.checksState === "passing") words.push({ text: "Checks passed", tone: "muted" });
  if (snapshot.reviewDecision === "approved") words.push({ text: "Approved", tone: "muted" });
  else if (snapshot.reviewDecision === "changes-requested") {
    words.push({ text: "Changes requested", tone: "failed" });
  } else if (snapshot.reviewDecision === "review-required") {
    words.push({ text: "Review required", tone: "muted" });
  } else if (snapshot.reviewDecision === null) {
    words.push({ text: "Review not requested", tone: "muted" });
  }
  return words;
}
