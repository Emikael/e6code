const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const WINDOWS_ICON_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

/** Renditions below this size show only the tile and the E6 glyph. */
const SMALL_ICON_MAX_EXCLUSIVE = 64;
/** Detail layers that blur into a smudge at small sizes, by Icon Composer layer name. */
const SMALL_ICON_DROPPED_LAYERS: ReadonlySet<string> = new Set(["Step meter", "Channel label"]);

export const isSmallIconSize = (size: number) => size < SMALL_ICON_MAX_EXCLUSIVE;

interface IconComposerDocument {
  readonly groups: ReadonlyArray<{ readonly layers: ReadonlyArray<{ readonly name?: string }> }>;
}

/** Rewrites an Icon Composer `icon.json` without the layers dropped at small sizes. */
export function withoutSmallSizeLayers(iconJson: string): string {
  const document: IconComposerDocument = JSON.parse(iconJson);
  let dropped = 0;
  const groups = document.groups.map((group) => {
    const layers = group.layers.filter((layer) => !SMALL_ICON_DROPPED_LAYERS.has(layer.name ?? ""));
    dropped += group.layers.length - layers.length;
    return { ...group, layers };
  });
  if (dropped === 0) {
    throw new Error(
      `Icon Composer project has no ${[...SMALL_ICON_DROPPED_LAYERS].join(" or ")} layer to drop at small sizes.`,
    );
  }
  return JSON.stringify({ ...document, groups }, null, 2);
}

export interface PngIconImage {
  readonly size: number;
  readonly contents: Buffer;
}

export function readPngDimensions(contents: Buffer): {
  readonly width: number;
  readonly height: number;
} {
  if (
    contents.length < 24 ||
    !contents.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    contents.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new Error("Icon Composer produced an invalid PNG.");
  }

  return {
    width: contents.readUInt32BE(16),
    height: contents.readUInt32BE(20),
  };
}

/** Encodes PNG renditions directly into a modern, multi-resolution ICO file. */
export function encodePngIco(images: ReadonlyArray<PngIconImage>): Buffer {
  if (images.length === 0) {
    throw new Error("An ICO file requires at least one PNG rendition.");
  }

  const seenSizes = new Set<number>();
  for (const image of images) {
    if (!Number.isInteger(image.size) || image.size < 1 || image.size > 256) {
      throw new Error(`ICO rendition size must be an integer from 1 to 256, got ${image.size}.`);
    }
    if (seenSizes.has(image.size)) {
      throw new Error(`ICO rendition size ${image.size} was provided more than once.`);
    }
    if (image.contents.length === 0) {
      throw new Error(`ICO rendition ${image.size}x${image.size} is empty.`);
    }
    seenSizes.add(image.size);
  }

  const headerSize = 6;
  const directoryEntrySize = 16;
  const directorySize = directoryEntrySize * images.length;
  const header = Buffer.alloc(headerSize + directorySize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let imageOffset = header.length;
  images.forEach((image, index) => {
    const entryOffset = headerSize + index * directoryEntrySize;
    const encodedSize = image.size === 256 ? 0 : image.size;
    header.writeUInt8(encodedSize, entryOffset);
    header.writeUInt8(encodedSize, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(image.contents.length, entryOffset + 8);
    header.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += image.contents.length;
  });

  return Buffer.concat([header, ...images.map((image) => image.contents)]);
}
