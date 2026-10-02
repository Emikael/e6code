#!/usr/bin/env node

// Renders the Android launcher and splash artwork from the Icon Composer SVG sources.
//
// Icon Composer exports already contain a rounded-square silhouette, and Android masks
// the central 72dp of a 108dp adaptive canvas, so exporting them as a foreground produces
// a double-framed icon with the letters cropped by the mask. Instead, each variant gets a
// full-bleed background layer (the artwork behind the wordmark) and a shared transparent
// foreground that keeps the wordmark inside the safe zone.
//
// The Android 12+ splash screen masks its icon to a circle covering the central two thirds
// of a 288dp canvas, which is the same proportion the launcher crops. Composing the two
// adaptive layers into one 288dp image therefore makes the splash frame the wordmark
// exactly like the launcher icon does.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import sharp from "sharp";

type IconVariant = "dev" | "nightly" | "prod";

// 108dp at xxxhdpi. Expo's prebuild derives every launcher density bucket from this.
const ADAPTIVE_CANVAS = 432;
// 288dp at xxxhdpi: the full Android 12+ splash canvas, so the icon needs no upscaling.
const SPLASH_CANVAS = 1152;
// Icon Composer's layer sources use a 128pt viewBox; the wordmark path spans this box.
const TEXT = { x: 16, y: 36, width: 95, height: 59 };
// Wordmark width as a fraction of the 108dp canvas. The visible area is 72dp (66dp
// guaranteed), so 0.48 leaves the letters at ~72% of the mask with room for the
// launcher's own zoom effects.
const WORDMARK_FRACTION = 0.48;
const SVG_DENSITY = 300;
const OUTPUT_DIRECTORY = "apps/mobile/assets";

export class AndroidIconRenderError extends Schema.TaggedError<AndroidIconRenderError>()(
  "AndroidIconRenderError",
  { layer: Schema.String, cause: Schema.Defect() },
) {}

const wordmarkTransform = (size: number, fraction = WORDMARK_FRACTION) => {
  const scale = (size * fraction) / TEXT.width;
  const tx = (size - TEXT.width * scale) / 2 - TEXT.x * scale;
  const ty = (size - TEXT.height * scale) / 2 - TEXT.y * scale;
  return `translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${scale.toFixed(4)})`;
};

const canvasSvg = (size: number, inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">${inner}</svg>`;

// The layer sources clip to a 10pt rounded rectangle for the iOS silhouette. Android
// applies its own mask, so the layer must bleed to the canvas edge.
const fullBleed = (svg: string) =>
  svg.replace(/<rect width="128" height="128" rx="10"\/>/, '<rect width="128" height="128"/>');

const rasterize = (layer: string, svg: string, width: number, height = width) =>
  Effect.tryPromise({
    try: () =>
      sharp(Buffer.from(svg), { density: SVG_DENSITY }).resize(width, height).png().toBuffer(),
    catch: (cause) => new AndroidIconRenderError({ layer, cause }),
  });

const composite = (
  layer: string,
  base: Buffer,
  overlays: ReadonlyArray<{ input: Buffer; left?: number; top?: number }>,
) =>
  Effect.tryPromise({
    try: () =>
      sharp(base)
        .composite([...overlays])
        .png()
        .toBuffer(),
    catch: (cause) => new AndroidIconRenderError({ layer, cause }),
  });

const readLayerSource = Effect.fn("androidIcons.readLayerSource")(function* (
  repositoryRoot: string,
  variant: IconVariant,
  file: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* fs.readFileString(
    path.join(repositoryRoot, "assets", variant, "app-icon.icon", "Assets", file),
  );
});

const renderForeground = Effect.fn("androidIcons.renderForeground")(function* (
  repositoryRoot: string,
  size: number,
  fraction = WORDMARK_FRACTION,
) {
  const text = yield* readLayerSource(repositoryRoot, "prod", "text.svg");
  const paths = text.match(/<path[^>]*\/>/g) ?? [];
  return yield* rasterize(
    "foreground",
    canvasSvg(size, `<g transform="${wordmarkTransform(size, fraction)}">${paths.join("")}</g>`),
    size,
  );
});

// Every channel's ground (and its brand band) lives in background.svg, which
// Icon Composer scales past the canvas edge; rasterize it full-bleed here.
const renderBackground = Effect.fn("androidIcons.renderBackground")(function* (
  repositoryRoot: string,
  variant: IconVariant,
  size: number,
) {
  const ground = yield* readLayerSource(repositoryRoot, variant, "background.svg");
  return yield* rasterize(`${variant}-background`, fullBleed(ground), size);
});

const renderSplashIcon = Effect.fn("androidIcons.renderSplashIcon")(function* (
  repositoryRoot: string,
  variant: IconVariant,
) {
  const background = yield* renderBackground(repositoryRoot, variant, SPLASH_CANVAS);
  const foreground = yield* renderForeground(repositoryRoot, SPLASH_CANVAS);
  return yield* composite(`${variant}-splash`, background, [{ input: foreground }]);
});

const exportAndroidIcons = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  const outputs = [
    ["android-icon-foreground.png", yield* renderForeground(repositoryRoot, ADAPTIVE_CANVAS)],
    ["android-icon-mark.png", yield* renderForeground(repositoryRoot, ADAPTIVE_CANVAS, 0.65)],
    [
      "android-icon-background-dev.png",
      yield* renderBackground(repositoryRoot, "dev", ADAPTIVE_CANVAS),
    ],
    [
      "android-icon-background-nightly.png",
      yield* renderBackground(repositoryRoot, "nightly", ADAPTIVE_CANVAS),
    ],
    ["android-splash-icon-dev.png", yield* renderSplashIcon(repositoryRoot, "dev")],
    ["android-splash-icon-nightly.png", yield* renderSplashIcon(repositoryRoot, "nightly")],
    ["android-splash-icon-prod.png", yield* renderSplashIcon(repositoryRoot, "prod")],
  ] as const;
  for (const [name, contents] of outputs) {
    yield* fs.writeFile(path.join(repositoryRoot, OUTPUT_DIRECTORY, name), contents);
    yield* Console.log(`wrote ${OUTPUT_DIRECTORY}/${name}`);
  }
});

if (import.meta.main) {
  exportAndroidIcons.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
