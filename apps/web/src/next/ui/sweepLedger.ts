/**
 * The requests whose decision surface has already swept. The sweep is the one attention
 * animation and plays once per request (design direction 3.4), so a surface that remounts for
 * the same approval or question, after a thread switch or a scroll, rests without it.
 */
export const createSweepLedger = () => {
  // ponytail: grows by one id per approval or question until reload; cap it if a session
  // ever holds enough requests to matter.
  const swept = new Set<string>();
  return {
    isNew: (requestId: string): boolean => !swept.has(requestId),
    record: (requestId: string): void => void swept.add(requestId),
  };
};

export const sweepLedger = createSweepLedger();
