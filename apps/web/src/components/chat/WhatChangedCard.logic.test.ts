import { describe, expect, it } from "vite-plus/test";

import { decideAttentionIntro, shouldShowWhatChanged } from "./WhatChangedCard.logic";

describe("shouldShowWhatChanged", () => {
  it("shows only once the profile was decided as existing, until dismissed", () => {
    expect(shouldShowWhatChanged({ dismissed: false })).toBe(true);
    expect(shouldShowWhatChanged({ dismissed: true })).toBe(false);
    expect(shouldShowWhatChanged({ dismissed: undefined })).toBe(false);
  });
});

describe("decideAttentionIntro", () => {
  const base = {
    decided: undefined,
    storedSettingsExisted: false,
    threadsLoaded: true,
    threadCount: 0,
  };

  it("decides an existing profile from its stored settings without waiting for threads", () => {
    expect(
      decideAttentionIntro({ ...base, storedSettingsExisted: true, threadsLoaded: false }),
    ).toEqual({ attentionIntroDismissed: false });
  });

  it("decides a profile without stored settings from its threads, once they load", () => {
    expect(decideAttentionIntro({ ...base, threadsLoaded: false })).toBeNull();
    expect(decideAttentionIntro({ ...base, threadCount: 3 })).toEqual({
      attentionIntroDismissed: false,
    });
    expect(decideAttentionIntro(base)).toEqual({ attentionIntroDismissed: true });
  });

  it("never decides twice, and waits for settings to be read", () => {
    expect(decideAttentionIntro({ ...base, decided: false, threadCount: 0 })).toBeNull();
    expect(decideAttentionIntro({ ...base, decided: true, threadCount: 4 })).toBeNull();
    expect(decideAttentionIntro({ ...base, storedSettingsExisted: null })).toBeNull();
  });
});
