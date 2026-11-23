import { createDynamicIcon } from "./dynamicIcon.tsx";

/**
 * String-keyed icon for persisted and dynamic names only (project icons, palette entries); each
 * name's module loads the first time it is drawn. Static use imports named components from
 * `index.ts`, which never re-exports this. Before ENG-96 generates the lazy modules, every name
 * renders `fallback`.
 */
export const Icon = createDynamicIcon(import.meta.glob("./generated/lazy/*.tsx"));
