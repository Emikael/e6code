import { describe, expect, it } from "vite-plus/test";

import { isComposerTyping } from "./composerTyping";

describe("isComposerTyping", () => {
  it("holds proactive panels while the focused composer has a message in it", () => {
    expect(isComposerTyping({ focusInComposer: true, prompt: "Fix the" })).toBe(true);
  });

  it("lets them open once focus leaves the composer, even with a draft left in it", () => {
    expect(isComposerTyping({ focusInComposer: false, prompt: "Fix the" })).toBe(false);
  });

  it("does not count an empty or blank composer as typing", () => {
    expect(isComposerTyping({ focusInComposer: true, prompt: "" })).toBe(false);
    expect(isComposerTyping({ focusInComposer: true, prompt: " \n " })).toBe(false);
    expect(isComposerTyping({ focusInComposer: true, prompt: undefined })).toBe(false);
  });
});
