import { ICONS, type IconEntry, type IconName, type IconState } from "@e6tools/design-tokens/icons";

// How a semantic registry name becomes the SF Symbol each platform draws. Pure, with no React
// Native import, so it runs under vitest; AppSymbol renders the result.

/** Registry names with an SF Symbol: what iOS can draw. */
export type SfIconName = {
  [K in IconName]: (typeof ICONS)[K] extends { readonly sf: object } ? K : never;
}[IconName];

type SfOf<K extends SfIconName> = Extract<(typeof ICONS)[K], { readonly sf: object }>["sf"];

/** Every SF name an entry carries: regular, fill and aliases. */
export type SfSymbolsOf<K extends SfIconName> =
  | SfOf<K>["regular"]
  | (SfOf<K> extends { readonly fill: infer Fill } ? Fill : never)
  | (SfOf<K> extends { readonly aliases: ReadonlyArray<infer Alias> } ? Alias : never);

const sfOf = (icon: SfIconName): NonNullable<IconEntry["sf"]> => ICONS[icon].sf;

/** iOS: `sf.fill` when active and the entry has one (whatever its `fillWhenActive`), else `sf.regular`. */
export function iosSymbolFor(icon: SfIconName, state?: IconState): string {
  const sf = sfOf(icon);
  return state === "active" && sf.fill !== undefined ? sf.fill : sf.regular;
}

/**
 * Android, in order: the iOS pick, then regular, then aliases, then fill. AppSymbol draws the
 * first one its Tabler map has.
 */
export function androidSymbolCandidates(
  icon: SfIconName,
  state?: IconState,
): ReadonlyArray<string> {
  const sf = sfOf(icon);
  const candidates = [iosSymbolFor(icon, state), sf.regular, ...(sf.aliases ?? [])];
  if (sf.fill !== undefined) candidates.push(sf.fill);
  return [...new Set(candidates)];
}
