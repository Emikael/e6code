import type { Plugin } from "vite-plus";

/**
 * Geist latin, normal style: the face the first app render needs. Italic, latin-ext, Cyrillic
 * and Geist Mono keep loading on demand through their `unicode-range` rules.
 */
const PRELOADED_FACE = /(?:^|\/)geist-latin-wght-normal-[\w-]+\.woff2$/;

/**
 * Preloads the Geist face from `index.html` so it downloads beside the entry script instead
 * of after the stylesheet applies. The hashed name exists only once the bundle is written,
 * so this runs on build alone; dev keeps the late discovery. The URL stays under the
 * configured base, so remote browsers load it from the origin that served the page.
 */
export function fontPreloadPlugin(): Plugin {
  let base = "/";
  return {
    name: "e6:font-preload",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, context) {
        const face = Object.keys(context.bundle ?? {}).find((name) => PRELOADED_FACE.test(name));
        if (!face) return;
        return [
          {
            tag: "link",
            // Font fetches are always CORS requests; without `crossorigin` the preload is
            // fetched a second time.
            attrs: {
              rel: "preload",
              as: "font",
              type: "font/woff2",
              crossorigin: true,
              href: base + face,
            },
            injectTo: "head-prepend",
          },
        ];
      },
    },
  };
}
