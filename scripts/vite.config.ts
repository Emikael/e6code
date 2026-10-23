import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

import baseConfig from "../vite.config.ts";

// Vitest 5 no longer finds a config in a parent directory, so this package takes the root
// test setup (timeouts, setup files) explicitly. Only those keys: `vp lint` and `vp fmt`
// run from a package directory use the nearest config, and the root's paths are repo-relative.
export default defineConfig({ resolve: baseConfig.resolve!, test: baseConfig.test! });
