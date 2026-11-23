/**
 * The icon layer's static entry (E03-T04): the only module v2 code imports icons from. Each icon
 * is a named component (`IconChevronDown`) that ENG-96 generates and re-exports below the types.
 *
 * It never re-exports `Icon` from `./Icon.tsx`. That string-keyed loader holds a loader for every
 * registry entry and is for persisted and dynamic names only; re-exporting it here would put it
 * on every route that draws a static icon. `staticPath.test.ts` keeps this path off it and off
 * the registry's data.
 */
export type { IconName } from "@e6tools/design-tokens/icons";
export type { IconState } from "@e6tools/design-tokens/iconWeight";
export type { IconProps, IconSize } from "./IconSvg.tsx";
