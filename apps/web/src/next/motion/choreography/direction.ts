/**
 * Which way `sideBySide` travels between two levels of a nested surface (a submenu, a
 * settings page): `forward` going deeper, `back` going up, `null` between peers, which cut.
 */
export const depthDirection = (fromDepth: number, toDepth: number): "forward" | "back" | null =>
  toDepth > fromDepth ? "forward" : toDepth < fromDepth ? "back" : null;
