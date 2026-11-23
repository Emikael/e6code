// No imports and no `~` alias: the icon generator (ENG-96) runs in Node and imports this file by
// relative path, so generated components and the dynamic loader agree on every name.

/** The component a registry name generates: "chevron-down" -> "IconChevronDown". */
export function iconComponentName(name: string): string {
  const words = name.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return `Icon${words.join("")}`;
}

/**
 * The `import.meta.glob` key of a name's lazy module, which exports `iconComponentName(name)`:
 * "chevron-down" -> "./generated/lazy/IconChevronDown.tsx". The only place that names the folder.
 */
export function lazyIconModulePath(name: string): string {
  return `./generated/lazy/${iconComponentName(name)}.tsx`;
}
