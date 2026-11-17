import type { ComponentProps } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { LightWash } from "./LightWash.tsx";

let renderer: ReactTestRenderer | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  // Claims are per page: unmount, so one test's washes do not hold the next test's light.
  await act(() => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

/** A wash inside a named region, so a test can say where the light is. */
function Region({ name, ...wash }: { readonly name: string } & ComponentProps<typeof LightWash>) {
  return (
    <section data-region={name}>
      <LightWash {...wash} />
    </section>
  );
}

const render = async (...regions: ReadonlyArray<ComponentProps<typeof Region>>) => {
  const tree = (
    <>
      {regions.map((region) => (
        <Region key={region.name} {...region} />
      ))}
    </>
  );
  await act(() => {
    if (renderer) renderer.update(tree);
    else renderer = create(tree);
  });
};

const washIn = (name: string) =>
  renderer!.root.findByProps({ "data-region": name }).findAllByProps({ className: "light-wash" });

/** Every mounted wash, as `region:lit` or `region:dark`. */
const washes = () =>
  renderer!.root
    .findAll((node) => node.type === "section")
    .flatMap((region) =>
      washIn(region.props["data-region"]).map(
        (wash) => `${region.props["data-region"]}:${wash.props["data-on"] === "" ? "lit" : "dark"}`,
      ),
    );

describe("LightWash", () => {
  it("mounts one wash per kind, the newest that is on", async () => {
    await render(
      { name: "header", kind: "key" },
      { name: "composer", kind: "key" },
      { name: "approval", kind: "attention" },
      { name: "footer", kind: "key", on: false },
    );

    expect(washes()).toEqual(["composer:lit", "approval:lit"]);
  });

  it("moves the light to an older wash when the newest turns off", async () => {
    await render({ name: "header", kind: "key" }, { name: "composer", kind: "key" });
    expect(washes()).toEqual(["composer:lit"]);

    await render({ name: "header", kind: "key" }, { name: "composer", kind: "key", on: false });
    expect(washes()).toEqual(["header:lit"]);
  });

  it("keeps a lone wash mounted while it is off, so it fades instead of cutting", async () => {
    await render({ name: "composer", kind: "key" });
    const [wash] = washIn("composer");

    // Reading the same instance after each change throws if the wash was remounted.
    await render({ name: "composer", kind: "key", on: false });
    expect(wash!.props["data-on"]).toBeUndefined();

    await render({ name: "composer", kind: "key" });
    expect(wash!.props["data-on"]).toBe("");
  });
});
