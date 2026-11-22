import type { IconName } from "@e6tools/design-tokens/icons";
import { Component, type ComponentType, forwardRef, memo, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createDynamicIcon } from "./dynamicIcon.tsx";
import { Icon as AppIcon } from "./Icon.tsx";
import type { IconProps } from "./IconSvg.tsx";

let renderer: ReactTestRenderer | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

/** Stands in for an error boundary above the icon: it shows "boundary" once anything throws. */
class Boundary extends Component<{ readonly children: ReactNode }, { readonly caught: boolean }> {
  override state = { caught: false };
  static getDerivedStateFromError() {
    return { caught: true };
  }
  override render() {
    return this.state.caught ? "boundary" : this.props.children;
  }
}

/**
 * The folder icon's chunk, requested through the loader and settled by the test, as a network
 * request would be. Each request stays pending until `settle`.
 */
const folderChunk = () => {
  const requests: Array<{ resolve: (module: unknown) => void; reject: (error: unknown) => void }> =
    [];
  const load = vi.fn(
    () => new Promise<unknown>((resolve, reject) => void requests.push({ resolve, reject })),
  );
  const settle = (outcome: "loads" | "fails" | "lacks the export") =>
    act(async () => {
      const request = requests.at(-1)!;
      if (outcome === "fails") request.reject(new Error("chunk failed to load"));
      else
        request.resolve(outcome === "loads" ? await import("./testing/IconFolderFixture.tsx") : {});
    });
  return { load, settle };
};

/** A loader over one lazy module, typed as the app's `Icon` so its props are the real contract. */
const setup = () => {
  const folder = folderChunk();
  const Icon: typeof AppIcon = createDynamicIcon({
    "./generated/lazy/IconFolder.tsx": folder.load,
  });
  return { Icon, folder };
};

const mount = (element: ReactNode) =>
  act(() => {
    renderer = create(<Boundary>{element}</Boundary>);
  });

/**
 * What the icon slot shows: the drawn icon, the empty placeholder box, or the caller's node.
 * Icons read as `<name> <size> <accessible name>`; the box has no name because it draws nothing.
 */
const shown = () => {
  const describeNode = (node: ReturnType<ReactTestRenderer["toJSON"]>): string => {
    if (node === null) return "nothing";
    if (typeof node === "string") return node;
    if (Array.isArray(node)) return node.map(describeNode).join(", ");
    if (node.type !== "svg") return node.type;
    const name = node.props["aria-hidden"] === true ? "hidden" : `"${node.props["aria-label"]}"`;
    return `${node.props["data-icon"] ?? "box"} ${node.props.width} ${name}`;
  };
  return describeNode(renderer!.toJSON());
};

describe("dynamic Icon", () => {
  it.each(["add", "not-an-icon", "constructor", "__proto__", "", "folder/../add"])(
    "renders the fallback for %j, which has no module, and loads nothing",
    async (name) => {
      const { Icon, folder } = setup();
      await mount(<Icon name={name as IconName} fallback="no icon" />);
      expect(shown()).toBe("no icon");
      expect(folder.load).not.toHaveBeenCalled();
    },
  );

  // The real glob, which matches nothing until ENG-96 generates the lazy modules. A name outside
  // the registry never gets one, so this stays a miss.
  it("renders the fallback from the app's Icon for a name it has no module for", async () => {
    await mount(<AppIcon name={"not-an-icon" as IconName} fallback="no icon" />);
    expect(shown()).toBe("no icon");
  });

  it("renders nothing for a miss unless the caller gives a fallback", async () => {
    const { Icon } = setup();
    await mount(<Icon name="add" />);
    expect(shown()).toBe("nothing");
  });

  it("only takes registry names", async () => {
    const { Icon } = setup();
    // @ts-expect-error A stored name outside the registry is mapped before it reaches Icon.
    await mount(<Icon name="not-an-icon" fallback="no icon" />);
    expect(shown()).toBe("no icon");
  });

  it("holds a same-size box with the label while the chunk loads, then draws the icon", async () => {
    const { Icon, folder } = setup();
    await mount(<Icon name="folder" size={20} label="Project" />);
    expect(shown()).toBe('box 20 "Project"');

    await folder.settle("loads");
    expect(shown()).toBe('folder 20 "Project"');
  });

  it("shows the caller's placeholder while loading, never the fallback", async () => {
    const { Icon, folder } = setup();
    await mount(<Icon name="folder" placeholder="loading" fallback="no icon" />);
    expect(shown()).toBe("loading");

    await folder.settle("loads");
    expect(shown()).toBe("folder 16 hidden");
  });

  it("loads a name once, and draws it on a later mount without a placeholder frame", async () => {
    const { Icon, folder } = setup();
    await mount(
      <>
        <Icon name="folder" />
        <Icon name="folder" size={14} />
        <Icon name="folder" state="active" />
      </>,
    );
    expect(shown()).toBe("box 16 hidden, box 14 hidden, box 16 hidden");
    await folder.settle("loads");
    expect(shown()).toBe("folder 16 hidden, folder 14 hidden, folder 16 hidden");
    await act(() => renderer?.unmount());

    // A synchronous act cannot flush a chunk that is still loading, so a suspended mount would
    // still show the box here.
    act(() => {
      renderer = create(<Icon name="folder" />);
    });
    expect(shown()).toBe("folder 16 hidden");
    expect(folder.load).toHaveBeenCalledTimes(1);
  });

  // `typeof` reports these as objects, not functions.
  const wrappers = {
    memo: (Inner: ComponentType<IconProps>) => memo(Inner),
    forwardRef: (Inner: ComponentType<IconProps>) =>
      forwardRef<SVGSVGElement, IconProps>((props, _ref) => <Inner {...props} />),
  };

  it.each(Object.keys(wrappers) as Array<keyof typeof wrappers>)(
    "draws an icon its module exports through %s",
    async (wrapper) => {
      const { IconFolder } = await import("./testing/IconFolderFixture.tsx");
      const load = vi.fn(async () => ({ IconFolder: wrappers[wrapper](IconFolder) }));
      const Icon: typeof AppIcon = createDynamicIcon({ "./generated/lazy/IconFolder.tsx": load });
      await mount(<Icon name="folder" fallback="no icon" />);
      await act(async () => {});
      expect(shown()).toBe("folder 16 hidden");
    },
  );

  it.each(["fails", "lacks the export"] as const)(
    "renders the fallback when the chunk %s, and retries on the next mount",
    async (failure) => {
      const { Icon, folder } = setup();
      await mount(<Icon name="folder" fallback="no icon" />);
      await folder.settle(failure);
      expect(shown()).toBe("no icon");

      // The same mount keeps its outcome: a re-render neither loads again nor flashes the box,
      // and it shows the fallback the caller passes now.
      await act(() =>
        renderer!.update(
          <Boundary>
            <Icon name="folder" fallback="still none" />
          </Boundary>,
        ),
      );
      expect(shown()).toBe("still none");
      expect(folder.load).toHaveBeenCalledTimes(1);
      await act(() => renderer?.unmount());

      await mount(<Icon name="folder" fallback="no icon" />);
      expect(shown()).toBe("box 16 hidden");
      expect(folder.load).toHaveBeenCalledTimes(2);
      await folder.settle("loads");
      expect(shown()).toBe("folder 16 hidden");
    },
  );
});
