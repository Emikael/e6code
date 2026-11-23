import { describe, expect, it } from "vite-plus/test";

import { distAssetPath } from "./bundle.ts";

describe("distAssetPath", () => {
  const distDir = "/repo/apps/web/dist";

  it("maps a served script to its file in the build", () => {
    expect(distAssetPath("http://127.0.0.1:41000/assets/index-BgDaEnEv.js", distDir)).toBe(
      "/repo/apps/web/dist/assets/index-BgDaEnEv.js",
    );
  });

  it("ignores the query string and the origin", () => {
    expect(distAssetPath("http://127.0.0.1:42000/assets/chat-x1.js?v=2#h", distDir)).toBe(
      "/repo/apps/web/dist/assets/chat-x1.js",
    );
  });

  it("skips anything that is not a built script", () => {
    expect(distAssetPath("http://127.0.0.1:1/assets/index.css", distDir)).toBeNull();
    expect(distAssetPath("http://127.0.0.1:1/api/auth/session", distDir)).toBeNull();
    expect(distAssetPath("http://127.0.0.1:1/sw.js", distDir)).toBeNull();
    expect(distAssetPath("not a url", distDir)).toBeNull();
  });

  it("refuses paths that leave the assets directory", () => {
    expect(distAssetPath("http://127.0.0.1:1/assets/%2e%2e/secret.js", distDir)).toBeNull();
    expect(distAssetPath("http://127.0.0.1:1/assets/nested/../../x.js", distDir)).toBeNull();
  });
});
