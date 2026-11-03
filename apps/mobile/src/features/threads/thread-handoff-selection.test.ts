import { describe, expect, it } from "vite-plus/test";

import { ProviderInstanceId, type ServerConfig } from "@e6tools/contracts";

import {
  buildMobileHandoffCatalog,
  handoffSelectionLabel,
  isHandoffSelectionStartable,
  limitedHandoffNote,
  resolveHandoffDefaultSelection,
} from "./thread-handoff-selection";

const effortCaps = {
  optionDescriptors: [
    {
      id: "effort",
      label: "Effort",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "high", label: "High", isDefault: true },
      ],
    },
  ],
};

function provider(
  instanceId: string,
  models: ReadonlyArray<{ slug: string; isDefault?: boolean; isLegacy?: boolean }>,
  extra: { usedPercent?: number; enabled?: boolean } = {},
) {
  return {
    instanceId,
    driver: instanceId,
    displayName: instanceId[0]!.toUpperCase() + instanceId.slice(1),
    enabled: extra.enabled ?? true,
    installed: true,
    auth: { status: "authenticated" },
    models: models.map((model) => ({
      slug: model.slug,
      name: model.slug.toUpperCase(),
      isCustom: false,
      isDefault: model.isDefault,
      isLegacy: model.isLegacy,
      capabilities: effortCaps,
    })),
    ...(extra.usedPercent === undefined
      ? {}
      : {
          usageLimits: {
            checkedAt: "2026-11-03T00:00:00.000Z",
            windows: [{ id: "w", kind: "session", label: "5h", usedPercent: extra.usedPercent }],
          },
        }),
  };
}

const config = {
  providers: [
    provider("codex", [{ slug: "gpt" }], { usedPercent: 100 }),
    provider("grok", [{ slug: "grok-build" }], { usedPercent: 100 }),
    provider("cursor", [{ slug: "auto" }], { enabled: false }),
    provider("claude", [
      { slug: "old", isLegacy: true },
      { slug: "opus" },
      { slug: "fable", isDefault: true },
    ]),
    provider("opencode", [{ slug: "pickle", isDefault: true }]),
  ],
} as unknown as ServerConfig;

const catalog = buildMobileHandoffCatalog(config, "codex");
const claude = ProviderInstanceId.make("claude");

describe("buildMobileHandoffCatalog", () => {
  it("offers usable non-source providers, flags limited ones and lists only available models", () => {
    expect(catalog.targets.map((target) => [target.instanceId, target.available])).toEqual([
      ["claude", true],
      ["opencode", true],
      ["grok", false],
    ]);
    expect(catalog.targets[0]?.model).toBe("fable");
    expect(new Set(catalog.options.map((option) => option.providerKey))).toEqual(
      new Set(["claude", "opencode"]),
    );
  });
});

describe("resolveHandoffDefaultSelection", () => {
  it("keeps the last pick when it is still offered, normalizing its options", () => {
    const selection = resolveHandoffDefaultSelection(catalog, {
      instanceId: claude,
      model: "opus",
      options: [{ id: "effort", value: "low" }],
    });
    expect(selection).toEqual({
      instanceId: "claude",
      model: "opus",
      options: [{ id: "effort", value: "low" }],
    });
  });

  it("falls back to the first available default when the last pick is limited, the source or gone", () => {
    for (const sticky of [
      { instanceId: ProviderInstanceId.make("grok"), model: "grok-build" },
      { instanceId: ProviderInstanceId.make("codex"), model: "gpt" },
      { instanceId: claude, model: "removed" },
      null,
    ]) {
      expect(resolveHandoffDefaultSelection(catalog, sticky)).toMatchObject({
        instanceId: "claude",
        model: "fable",
      });
    }
  });

  it("returns null when every other provider is limited", () => {
    const limited = buildMobileHandoffCatalog(
      { providers: [config.providers[0], config.providers[1]] } as unknown as ServerConfig,
      "codex",
    );
    expect(limited.targets).toHaveLength(1);
    expect(resolveHandoffDefaultSelection(limited, null)).toBeNull();
  });
});

describe("isHandoffSelectionStartable", () => {
  it("accepts offered models only", () => {
    expect(isHandoffSelectionStartable(catalog, { instanceId: claude, model: "opus" })).toBe(true);
    expect(
      isHandoffSelectionStartable(catalog, {
        instanceId: ProviderInstanceId.make("grok"),
        model: "grok-build",
      }),
    ).toBe(false);
    expect(isHandoffSelectionStartable(catalog, null)).toBe(false);
  });
});

describe("labels", () => {
  it("names the model with its effort", () => {
    expect(
      handoffSelectionLabel(catalog, {
        instanceId: claude,
        model: "opus",
        options: [{ id: "effort", value: "low" }],
      }),
    ).toBe("OPUS · Low");
  });

  it("lists limited providers left out of the picker", () => {
    expect(limitedHandoffNote(catalog.targets)).toBe("Grok is also at its usage limit.");
    expect(
      limitedHandoffNote([
        { instanceId: "a", model: "m", label: "Grok", usedPercent: 100, available: false },
        { instanceId: "b", model: "m", label: "Cursor", usedPercent: 100, available: false },
      ]),
    ).toBe("Grok and Cursor are also at their usage limits.");
    expect(limitedHandoffNote([])).toBeNull();
  });
});
