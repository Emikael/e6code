/**
 * Path pairs for the icons that morph (design direction 6.3): the sidebar toggle, the panel
 * toggles and play/stop. Every other state change is an `iconSwap`.
 *
 * Each state is a list of stroke nodes on the 24 grid, traced from the centerline of the
 * Phosphor regular artwork, drawn with round caps and joins at `ICON_MORPH_STROKE`. Both states
 * of a pair have the same nodes, commands and number of arguments, so interpolating number by
 * number morphs them: no shape matcher, in `morphicons` (IconNode form) or `motion` alike.
 *
 * Derived from Phosphor Icons (https://github.com/phosphor-icons/core), MIT License,
 * Copyright (c) 2023 Phosphor Icons.
 */

export type StrokeNode = readonly [
  tag: "path" | "line" | "rect" | "circle" | "polyline",
  attributes: Readonly<Record<string, string>>,
];

export interface IconMorph {
  readonly derivedFrom: ReadonlyArray<string>;
  /** The control that morphs. */
  readonly control: string;
  readonly states: Readonly<Record<string, ReadonlyArray<StrokeNode>>>;
}

/** Phosphor's regular (16/256) and bold (24/256) strokes on the 24 grid. */
export const ICON_MORPH_STROKE = { regular: 1.5, bold: 2.25 } as const;

export const ICON_MORPHS = {
  sidebar: {
    derivedFrom: ["sidebar-simple", "caret-left", "caret-right"],
    control: "The sidebar toggle.",
    states: {
      open: [
        [
          "path",
          {
            d: "M3.75 4.5 L20.25 4.5 C20.664 4.5 21 4.836 21 5.25 L21 18.75 C21 19.164 20.664 19.5 20.25 19.5 L3.75 19.5 C3.336 19.5 3 19.164 3 18.75 L3 5.25 C3 4.836 3.336 4.5 3.75 4.5 Z",
          },
        ],
        ["line", { x1: "8.25", y1: "4.5", x2: "8.25", y2: "19.5" }],
        ["path", { d: "M16.125 9 L13.125 12 L16.125 15" }],
      ],
      closed: [
        [
          "path",
          {
            d: "M3.75 4.5 L20.25 4.5 C20.664 4.5 21 4.836 21 5.25 L21 18.75 C21 19.164 20.664 19.5 20.25 19.5 L3.75 19.5 C3.336 19.5 3 19.164 3 18.75 L3 5.25 C3 4.836 3.336 4.5 3.75 4.5 Z",
          },
        ],
        ["line", { x1: "8.25", y1: "4.5", x2: "8.25", y2: "19.5" }],
        ["path", { d: "M13.125 9 L16.125 12 L13.125 15" }],
      ],
    },
  },
  "panel-right": {
    derivedFrom: ["sidebar-simple", "caret-left", "caret-right"],
    control: "The right-panel toggle.",
    states: {
      open: [
        [
          "path",
          {
            d: "M3.75 4.5 L20.25 4.5 C20.664 4.5 21 4.836 21 5.25 L21 18.75 C21 19.164 20.664 19.5 20.25 19.5 L3.75 19.5 C3.336 19.5 3 19.164 3 18.75 L3 5.25 C3 4.836 3.336 4.5 3.75 4.5 Z",
          },
        ],
        ["line", { x1: "15.75", y1: "4.5", x2: "15.75", y2: "19.5" }],
        ["path", { d: "M7.875 9 L10.875 12 L7.875 15" }],
      ],
      closed: [
        [
          "path",
          {
            d: "M3.75 4.5 L20.25 4.5 C20.664 4.5 21 4.836 21 5.25 L21 18.75 C21 19.164 20.664 19.5 20.25 19.5 L3.75 19.5 C3.336 19.5 3 19.164 3 18.75 L3 5.25 C3 4.836 3.336 4.5 3.75 4.5 Z",
          },
        ],
        ["line", { x1: "15.75", y1: "4.5", x2: "15.75", y2: "19.5" }],
        ["path", { d: "M10.875 9 L7.875 12 L10.875 15" }],
      ],
    },
  },
  "panel-bottom": {
    derivedFrom: ["sidebar-simple", "caret-down", "caret-up"],
    control: "The terminal-drawer toggle.",
    states: {
      open: [
        [
          "path",
          {
            d: "M3.75 4.5 L20.25 4.5 C20.664 4.5 21 4.836 21 5.25 L21 18.75 C21 19.164 20.664 19.5 20.25 19.5 L3.75 19.5 C3.336 19.5 3 19.164 3 18.75 L3 5.25 C3 4.836 3.336 4.5 3.75 4.5 Z",
          },
        ],
        ["line", { x1: "3", y1: "14.25", x2: "21", y2: "14.25" }],
        ["path", { d: "M9 7.875 L12 10.875 L15 7.875" }],
      ],
      closed: [
        [
          "path",
          {
            d: "M3.75 4.5 L20.25 4.5 C20.664 4.5 21 4.836 21 5.25 L21 18.75 C21 19.164 20.664 19.5 20.25 19.5 L3.75 19.5 C3.336 19.5 3 19.164 3 18.75 L3 5.25 C3 4.836 3.336 4.5 3.75 4.5 Z",
          },
        ],
        ["line", { x1: "3", y1: "14.25", x2: "21", y2: "14.25" }],
        ["path", { d: "M9 10.875 L12 7.875 L15 10.875" }],
      ],
    },
  },
  "play-stop": {
    derivedFrom: ["play", "stop"],
    control: "The primary project-script button: Run while idle, Stop while its script runs.",
    states: {
      play: [
        [
          "path",
          {
            d: "M7.891 3.111 L21.562 11.474 C21.741 11.584 21.849 11.777 21.849 11.986 L21.849 12.014 C21.849 12.223 21.741 12.416 21.562 12.526 L7.891 20.889 C7.392 21.195 6.75 20.836 6.75 20.25 L6.75 3.75 C6.75 3.164 7.392 2.805 7.891 3.111 Z",
          },
        ],
      ],
      stop: [
        [
          "path",
          {
            d: "M5.25 4.5 L18.75 4.5 C19.164 4.5 19.5 4.836 19.5 5.25 L19.5 18.75 C19.5 19.164 19.164 19.5 18.75 19.5 L5.25 19.5 C4.836 19.5 4.5 19.164 4.5 18.75 L4.5 5.25 C4.5 4.836 4.836 4.5 5.25 4.5 Z",
          },
        ],
      ],
    },
  },
} as const satisfies Record<string, IconMorph>;
