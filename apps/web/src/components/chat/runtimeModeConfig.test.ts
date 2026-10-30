import { describe, expect, it } from "vite-plus/test";

import { resolveRuntimeModeDisplay } from "./runtimeModeConfig";

describe("resolveRuntimeModeDisplay", () => {
  it("labels a mode that differs from the default", () => {
    expect(resolveRuntimeModeDisplay({ matchesDefault: false, hasTraitsMenu: true })).toBe("label");
    expect(resolveRuntimeModeDisplay({ matchesDefault: false, hasTraitsMenu: false })).toBe(
      "label",
    );
  });

  it("moves the default mode into the effort menu when there is one", () => {
    expect(resolveRuntimeModeDisplay({ matchesDefault: true, hasTraitsMenu: true })).toBe("hidden");
  });

  it("keeps an icon for the default mode when the model has no effort menu", () => {
    expect(resolveRuntimeModeDisplay({ matchesDefault: true, hasTraitsMenu: false })).toBe("icon");
  });
});
