import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const v2File = createOxlintRuleHarness("e6code/no-raw-tailwind-palette-colors", {
  filename: "apps/web/src/next/components/Surface.tsx",
});

describe("e6code/no-raw-tailwind-palette-colors", () => {
  v2File.valid(
    "allows semantic roles",
    `const surface = <div className="bg-primary text-primary-foreground border-border/60 ring-primary-edge" />;`,
  );

  v2File.valid(
    "allows palette words outside utilities",
    `const copy = "The sky-500 swatch and a blue-500 pen"; const id = "my-bg-blue-500-chart";`,
  );

  v2File.invalid(
    "reports a palette utility in a className",
    `const surface = <div className="flex bg-blue-500" />;`,
    (output) => {
      assert.match(output, /semantic role/);
    },
  );

  v2File.invalid(
    "reports variants and opacity modifiers in cn arguments",
    `const cls = cn("rounded", isActive && "hover:text-zinc-400/50");`,
  );

  v2File.invalid("reports hard-coded white text", `const cls = cva("text-white");`);

  v2File.invalid(
    "reports palette utilities in template literals",
    "const cls = `px-2 ${tone} dark:border-x-slate-950`;",
  );
});
