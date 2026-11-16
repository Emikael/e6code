/**
 * Whether at least one redesigned (v2) screen is enabled on this device. Controls that only
 * affect v2 screens, such as the Motion setting row and the "Change motion" palette entry,
 * are shown only when this is true, so classic users never see a control that does nothing.
 *
 * Always false until the screen-flag registry exists: E04-T14 replaces this body with a
 * reactive read of that registry. Every caller goes through this one hook.
 */
export const useAnyRedesignedScreenEnabled = (): boolean => false;
