import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const RULE = "e6code/no-icon-library-imports";
const rule = createOxlintRuleHarness(RULE, { filename: "fixture.tsx" });
const morphGrant = createOxlintRuleHarness(RULE, {
  filename: "fixture.tsx",
  ruleOptions: [{ allow: ["morphicons"] }],
});

describe(RULE, () => {
  rule.valid(
    "allows the icon layer, the registry and packages that only start like a library",
    `
      import type { IconName } from "@e6tools/design-tokens/icons";
      import { iconWeight } from "@e6tools/design-tokens/iconWeight";
      import { IconFolder } from "~/next/icons";
      import { IconAdd } from "./icons";
      import { lucid } from "lucid";
      import { reactive } from "lucide-reactive";
      export type T = IconName;
      export { iconWeight, IconFolder, IconAdd, lucid, reactive };
    `,
  );

  rule.invalid(
    "reports a named Lucide import and points at the layer",
    `
      import { ChevronDown } from "lucide-react";
      export { ChevronDown };
    `,
    (output) => {
      assert.match(output, /Do not import lucide-react here/);
      assert.match(output, /apps\/web\/src\/next\/icons on web, AppSymbol on mobile/);
      // The longer package wins: a lucide-react import is never reported as plain lucide.
      assert.notMatch(output, /import lucide here/);
    },
  );

  rule.invalid(
    "reports Lucide's dynamic icon",
    `
      import { DynamicIcon } from "lucide-react/dynamic";
      export { DynamicIcon };
    `,
    (output) => assert.match(output, /import lucide-react here/),
  );

  rule.invalid(
    "reports a type-only import",
    `
      import type { LucideIcon } from "lucide-react";
      export type T = LucideIcon;
    `,
    (output) => assert.match(output, /import lucide-react here/),
  );

  rule.invalid(
    "reports raw Lucide data",
    `
      import { icons } from "lucide";
      export { icons };
    `,
    (output) => assert.match(output, /import lucide here/),
  );

  rule.invalid(
    "reports morph icons",
    `
      import { MorphIcon } from "morphicons/react";
      export { MorphIcon };
    `,
    (output) => assert.match(output, /import morphicons here/),
  );

  rule.invalid(
    "reports every Phosphor package",
    `
      import { House } from "@phosphor-icons/react";
      import { House as NativeHouse } from "phosphor-react-native";
      import { icons } from "@phosphor-icons/core";
      export { House, NativeHouse, icons };
    `,
    (output) => {
      assert.match(output, /import @phosphor-icons\/react here/);
      assert.match(output, /import phosphor-react-native here/);
      assert.match(output, /import @phosphor-icons\/core here/);
    },
  );

  rule.invalid(
    "reports a per-icon Tabler module",
    `
      import IconX from "@tabler/icons-react-native/IconX";
      export { IconX };
    `,
    (output) => assert.match(output, /import @tabler\/icons-react-native here/),
  );

  rule.invalid(
    "reports a dynamic import",
    `
      export const load = () => import("lucide-react");
    `,
  );

  rule.invalid(
    "reports a dynamic import written as a template literal",
    "export const load = () => import(`lucide-react/dynamic`);",
    (output) => assert.match(output, /import lucide-react here/),
  );

  rule.invalid(
    "reports require",
    `
      const icons = require("@tabler/icons-react");
      export default icons;
    `,
    (output) => assert.match(output, /import @tabler\/icons-react here/),
  );

  rule.invalid(
    "reports re-exports",
    `
      export * from "lucide-react";
      export { House } from "phosphor-react";
    `,
    (output) => {
      assert.match(output, /import lucide-react here/);
      assert.match(output, /import phosphor-react here/);
    },
  );

  morphGrant.valid(
    "lets a granted file import morph icons",
    `
      import { MorphIcon } from "morphicons/react";
      export { MorphIcon };
    `,
  );

  morphGrant.invalid(
    "does not extend a morph grant to Lucide",
    `
      import { MorphIcon } from "morphicons/react";
      import { ChevronDown } from "lucide-react";
      export { MorphIcon, ChevronDown };
    `,
    (output) => {
      assert.match(output, /import lucide-react here/);
      assert.notMatch(output, /import morphicons here/);
    },
  );
});
