/**
 * The slots a presence preset (`swap`, `iconSwap`, `numberChange`) renders: the present
 * content and at most one leaving. A new value while one is still leaving cuts the older
 * leaver, so rapid changes never stack, the newest value is the one present, and the leaving
 * slot retargets from where it is (it keeps its key). Pure, so the interruption rules are
 * tested without a DOM.
 */
export interface PresenceSlot<Content> {
  readonly key: string;
  readonly content: Content;
  readonly leaving: boolean;
  /** False only for what was there on mount, which does not animate in. */
  readonly enters: boolean;
}

export type PresenceAction<Content> =
  | { readonly type: "show"; readonly key: string; readonly content: Content }
  | { readonly type: "left"; readonly key: string };

export const initialPresenceSlots = <Content>(
  key: string,
  content: Content,
): ReadonlyArray<PresenceSlot<Content>> => [{ key, content, leaving: false, enters: false }];

export const presentSlot = <Content>(slots: ReadonlyArray<PresenceSlot<Content>>) =>
  slots.find((slot) => !slot.leaving);

export const presenceSlots = <Content>(
  slots: ReadonlyArray<PresenceSlot<Content>>,
  action: PresenceAction<Content>,
): ReadonlyArray<PresenceSlot<Content>> => {
  if (action.type === "left") {
    return slots.filter((slot) => !(slot.leaving && slot.key === action.key));
  }
  const present = presentSlot(slots);
  if (present?.key === action.key) return slots;
  return [
    ...(present ? [{ ...present, leaving: true }] : []),
    { key: action.key, content: action.content, leaving: false, enters: true },
  ];
};
