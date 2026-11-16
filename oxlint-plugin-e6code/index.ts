import { definePlugin } from "@oxlint/plugins";

import namespaceNodeImports from "./rules/namespace-node-imports.ts";
import noAnimationLibraryImports from "./rules/no-animation-library-imports.ts";
import noGlobalProcessRuntime from "./rules/no-global-process-runtime.ts";
import noHermesUnsupportedApis from "./rules/no-hermes-unsupported-apis.ts";
import noInlineSchemaCompile from "./rules/no-inline-schema-compile.ts";
import noManualEffectRuntimeInTests from "./rules/no-manual-effect-runtime-in-tests.ts";
import noMobileUniwindThemeEscapeHatches from "./rules/no-mobile-uniwind-theme-escape-hatches.ts";
import noNativeTitleTooltip from "./rules/no-native-title-tooltip.ts";
import noRawTailwindPaletteColors from "./rules/no-raw-tailwind-palette-colors.ts";

export default definePlugin({
  meta: {
    name: "e6code",
  },
  rules: {
    "namespace-node-imports": namespaceNodeImports,
    "no-animation-library-imports": noAnimationLibraryImports,
    "no-global-process-runtime": noGlobalProcessRuntime,
    "no-hermes-unsupported-apis": noHermesUnsupportedApis,
    "no-inline-schema-compile": noInlineSchemaCompile,
    "no-manual-effect-runtime-in-tests": noManualEffectRuntimeInTests,
    "no-mobile-uniwind-theme-escape-hatches": noMobileUniwindThemeEscapeHatches,
    "no-native-title-tooltip": noNativeTitleTooltip,
    "no-raw-tailwind-palette-colors": noRawTailwindPaletteColors,
  },
});
