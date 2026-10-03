import { assert, describe, it } from "@effect/vitest";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  CLI_COMMAND,
  DATA_DIR_NAME,
  HOSTED_APP_NIGHTLY_ORIGIN,
  HOSTED_APP_ORIGIN,
  PRODUCT_NAME,
  readBrandEnv,
  resolveDefaultDataDir,
  withLegacyBrandEnv,
} from "./brand.ts";

describe("brand", () => {
  it("names the product E6 Code and the CLI e6", () => {
    assert.equal(PRODUCT_NAME, "E6 Code");
    assert.equal(CLI_COMMAND, "e6");
    assert.equal(DATA_DIR_NAME, ".e6");
  });

  it("uses the stable channel host as the public hosted app", () => {
    assert.equal(HOSTED_APP_ORIGIN, "https://latest.app.e6code.com");
    assert.equal(HOSTED_APP_NIGHTLY_ORIGIN, "https://nightly.app.e6code.com");
  });

  it("reads E6CODE_* and treats a blank value as unset", () => {
    assert.equal(readBrandEnv({ E6CODE_PORT: "1" }, "PORT"), "1");
    assert.equal(readBrandEnv({ E6CODE_PORT: "2" }, "PORT"), "2");
    assert.equal(readBrandEnv({ E6CODE_HOME: "  " }, "HOME"), undefined);
    assert.equal(readBrandEnv({}, "HOME"), undefined);
  });

  it.effect("reads E6CODE_PORT in Config", () =>
    Effect.gen(function* () {
      const port = withLegacyBrandEnv("PORT", Config.Port);
      const preferred = yield* port.pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({
              env: { E6CODE_PORT: "4001" },
            }),
          ),
        ),
      );
      assert.equal(preferred, 4001);
    }),
  );

  it.effect("treats a blank E6CODE_* string as unset", () =>
    Effect.gen(function* () {
      const provide = (env: Record<string, string>) =>
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })));
      const home = withLegacyBrandEnv("HOME", Config.String).pipe(Config.option);
      assert.isUndefined(Option.getOrUndefined(yield* home.pipe(provide({}))));
      assert.equal(
        Option.getOrUndefined(yield* home.pipe(provide({ E6CODE_HOME: "/new" }))),
        "/new",
      );
      assert.equal(
        Option.getOrUndefined(yield* home.pipe(provide({ E6CODE_HOME: "/old" }))),
        "/old",
      );
      // Blank with no legacy value still resolves, so option/withDefault callers
      // can trim it. It must not throw.
      assert.equal(Option.getOrUndefined(yield* home.pipe(provide({ E6CODE_HOME: "  " }))), "  ");

      const level = withLegacyBrandEnv("LOG_LEVEL", Config.LogLevel).pipe(
        Config.withDefault("Info"),
      );
      assert.equal(yield* level.pipe(provide({})), "Info");
      assert.equal(yield* level.pipe(provide({ E6CODE_LOG_LEVEL: "Debug" })), "Debug");
      assert.equal(yield* level.pipe(provide({ E6CODE_LOG_LEVEL: "Warn" })), "Warn");
    }),
  );

  it("uses an existing .e6, otherwise .e6", () => {
    const join = (parent: string, name: string) => `${parent}/${name}`;
    assert.equal(
      resolveDefaultDataDir({
        parent: "/home/ada",
        join,
        exists: (path) => path === "/home/ada/.e6",
      }),
      "/home/ada/.e6",
    );
    assert.equal(
      resolveDefaultDataDir({
        parent: "/home/ada",
        join,
        exists: (path) => path === "/home/ada/.e6",
      }),
      "/home/ada/.e6",
    );
    assert.equal(
      resolveDefaultDataDir({
        parent: "/work/feature",
        join,
        exists: () => false,
      }),
      "/work/feature/.e6",
    );
  });
});
