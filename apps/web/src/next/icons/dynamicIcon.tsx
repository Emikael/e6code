import type { IconName } from "@e6tools/design-tokens/icons";
import {
  type ComponentType,
  lazy,
  type LazyExoticComponent,
  type ReactNode,
  Suspense,
  useMemo,
} from "react";

import { type IconProps, IconSvg } from "./IconSvg.tsx";
import { iconComponentName, lazyIconModulePath } from "./naming.ts";

/** `import.meta.glob` output: a loader per lazy module path. */
export type IconModuleLoaders = Readonly<Record<string, () => Promise<unknown>>>;

export interface DynamicIconProps extends IconProps {
  readonly name: IconName;
  /**
   * Shown for a name with no module, and when its chunk fails to load. Default null. It replaces
   * the svg, so a fallback that stands for a meaningful icon carries its own size and name.
   */
  readonly fallback?: ReactNode;
  /**
   * Shown while the chunk loads. Default: an empty box of the icon's size that carries `label`,
   * so nothing reflows. A placeholder replaces the svg, so it carries its own size and name.
   */
  readonly placeholder?: ReactNode;
}

interface LoadedIconProps {
  readonly icon: IconProps;
  readonly fallback: ReactNode;
}

/** What a failed load resolves to: the fallback of whichever mount renders it. */
function IconLoadFailed({ fallback }: LoadedIconProps) {
  return fallback;
}

const FAILED = { default: IconLoadFailed };
const PLACEHOLDER_TRAITS = { fillWhenActive: false } as const;

/** A component a module may export: a function, or one wrapped in `memo` or `forwardRef`. */
const isComponentType = (value: unknown) => {
  if (typeof value === "function") return true;
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { readonly $$typeof?: unknown }).$$typeof;
  return kind === Symbol.for("react.memo") || kind === Symbol.for("react.forward_ref");
};

/** The named component a lazy module exports, if it is there. */
const exportedComponent = (module: unknown, exportName: string) => {
  if (typeof module !== "object" || module === null || !(exportName in module)) return undefined;
  const value: unknown = (module as Record<string, unknown>)[exportName];
  return isComponentType(value) ? (value as ComponentType<IconProps>) : undefined;
};

/**
 * Builds the string-keyed `Icon` over `loaders` (tests inject their own). Each name gets one lazy
 * component for the page's lifetime, so a later mount draws without suspending. A failed load
 * renders the caller's fallback instead of throwing to an error boundary (a tunnel can drop a
 * chunk, a server update can remove one), and the next fresh mount tries again.
 */
export function createDynamicIcon(
  loaders: IconModuleLoaders,
): (props: DynamicIconProps) => ReactNode {
  const loaded = new Map<string, LazyExoticComponent<ComponentType<LoadedIconProps>>>();

  const lazyIcon = (name: string) => {
    const path = lazyIconModulePath(name);
    if (!Object.prototype.hasOwnProperty.call(loaders, path)) return null;
    const known = loaded.get(name);
    if (known !== undefined) return known;
    const evict = () => {
      if (loaded.get(name) === icon) loaded.delete(name);
      return FAILED;
    };
    const icon = lazy(() =>
      loaders[path]!().then((module) => {
        const Loaded = exportedComponent(module, iconComponentName(name));
        if (Loaded === undefined) return evict();
        const LoadedIcon = ({ icon: props }: LoadedIconProps) => <Loaded {...props} />;
        return { default: LoadedIcon };
      }, evict),
    );
    loaded.set(name, icon);
    return icon;
  };

  return function Icon({ name, fallback = null, placeholder, ...icon }: DynamicIconProps) {
    // Pinned per mount: after a failure, re-renders keep showing the fallback, and only a new
    // mount, which looks the name up again, retries.
    const LazyIcon = useMemo(() => lazyIcon(name), [name]);
    if (LazyIcon === null) return fallback;
    return (
      <Suspense
        fallback={
          placeholder === undefined ? (
            <IconSvg {...icon} name={name} traits={PLACEHOLDER_TRAITS} artwork={null} />
          ) : (
            placeholder
          )
        }
      >
        <LazyIcon icon={icon} fallback={fallback} />
      </Suspense>
    );
  };
}
