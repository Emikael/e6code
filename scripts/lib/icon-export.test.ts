import { assert, describe, it } from "@effect/vitest";

import {
  encodePngIco,
  isSmallIconSize,
  readPngDimensions,
  withoutSmallSizeLayers,
} from "./icon-export.ts";

const pngHeader = (width: number, height: number) => {
  const contents = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(contents);
  contents.write("IHDR", 12, "ascii");
  contents.writeUInt32BE(width, 16);
  contents.writeUInt32BE(height, 20);
  return contents;
};

describe("icon export", () => {
  it("reads dimensions from a PNG IHDR chunk", () => {
    assert.deepEqual(readPngDimensions(pngHeader(1024, 512)), { width: 1024, height: 512 });
  });

  it("encodes PNG renditions into an ICO directory", () => {
    const small = pngHeader(16, 16);
    const large = pngHeader(256, 256);
    const ico = encodePngIco([
      { size: 16, contents: small },
      { size: 256, contents: large },
    ]);

    assert.equal(ico.readUInt16LE(2), 1);
    assert.equal(ico.readUInt16LE(4), 2);
    assert.equal(ico.readUInt8(6), 16);
    assert.equal(ico.readUInt8(22), 0);
    assert.equal(ico.readUInt32LE(18), 38);
    assert.equal(ico.readUInt32LE(34), 38 + small.length);
    assert.deepEqual(ico.subarray(38, 38 + small.length), small);
    assert.deepEqual(ico.subarray(38 + small.length), large);
  });

  it("rejects duplicate ICO rendition sizes", () => {
    assert.throws(
      () =>
        encodePngIco([
          { size: 32, contents: pngHeader(32, 32) },
          { size: 32, contents: pngHeader(32, 32) },
        ]),
      /provided more than once/,
    );
  });

  it("drops the step meter and channel label layers for small renditions", () => {
    const layer = (name: string) => ({ name, "image-name": `${name}.svg` });
    const iconJson = JSON.stringify({
      fill: { solid: "display-p3:0,0,0,1" },
      groups: [
        { layers: [layer("Text"), layer("Step meter"), layer("Background")], shadow: {} },
        { layers: [layer("Channel label")] },
      ],
    });

    const small = JSON.parse(withoutSmallSizeLayers(iconJson));

    assert.deepEqual(small.fill, { solid: "display-p3:0,0,0,1" });
    assert.deepEqual(small.groups[0].layers, [layer("Text"), layer("Background")]);
    assert.deepEqual(small.groups[0].shadow, {});
    assert.deepEqual(small.groups[1].layers, []);
  });

  it("rejects a project without a small-size layer to drop", () => {
    const iconJson = JSON.stringify({ groups: [{ layers: [{ name: "Text" }] }] });
    assert.throws(() => withoutSmallSizeLayers(iconJson), /Step meter/);
  });

  it("treats renditions below 64px as small", () => {
    assert.isTrue(isSmallIconSize(48));
    assert.isFalse(isSmallIconSize(64));
  });
});
