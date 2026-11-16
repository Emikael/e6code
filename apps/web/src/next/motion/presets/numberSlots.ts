/**
 * Splits a formatted number into slots counted from the right, so "128" → "1,128" keeps the
 * slots of "1", "2" and "8". Within a slot the character is the presence key: only
 * characters that changed roll (`numberChange`).
 */
export const numberSlots = (value: string): ReadonlyArray<{ slot: number; char: string }> => {
  const chars = [...value];
  return chars.map((char, index) => ({ slot: chars.length - index, char }));
};
