import { describe, expect, it } from "vite-plus/test";

import phosphorNames from "./fixtures/phosphor-2.1.1-names.json" with { type: "json" };
import { ICON_MORPH_STROKE, ICON_MORPHS, type StrokeNode } from "./morphs.ts";

const PHOSPHOR = new Set<string>(phosphorNames);
const TAGS = new Set(["path", "line", "rect", "circle", "polyline"]);

type Command = { readonly letter: string; readonly args: ReadonlyArray<number> };

function parsePath(d: string): Array<Command> {
  const commands: Array<Command> = [];
  for (const [, letter, args] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const numbers = (args!.match(/-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/gi) ?? []).map(Number);
    commands.push({ letter: letter!, args: numbers });
  }
  return commands;
}

const numbersOf = (node: StrokeNode) =>
  node[0] === "path"
    ? parsePath(node[1].d ?? "").flatMap((command) => command.args)
    : Object.entries(node[1]).flatMap(([key, value]) =>
        key === "points"
          ? value
              .split(/[\s,]+/)
              .filter(Boolean)
              .map(Number)
          : [Number(value)],
      );

describe("icon morphs", () => {
  // Design direction 6.3: only these morph; every other state change is an iconSwap.
  it("keeps the sidebar toggle, the panel toggles and play/stop", () => {
    expect(Object.keys(ICON_MORPHS).sort()).toEqual(
      ["panel-bottom", "panel-right", "play-stop", "sidebar"].sort(),
    );
  });

  it("draws at Phosphor's regular and bold stroke on the 24 grid", () => {
    expect(ICON_MORPH_STROKE).toEqual({ regular: 1.5, bold: 2.25 });
  });

  for (const [name, morph] of Object.entries(ICON_MORPHS)) {
    describe(name, () => {
      const states = Object.values(morph.states);

      it("is traced from Phosphor 2.1.1 artwork", () => {
        expect(morph.derivedFrom.length).toBeGreaterThan(0);
        for (const source of morph.derivedFrom) expect(PHOSPHOR.has(source), source).toBe(true);
      });

      it("has two states with the same nodes in the same order", () => {
        expect(states).toHaveLength(2);
        const [from, to] = states as [ReadonlyArray<StrokeNode>, ReadonlyArray<StrokeNode>];
        expect(from.length).toBeGreaterThan(0);
        expect(to.map((node) => node[0])).toEqual(from.map((node) => node[0]));
        to.forEach((node, index) => {
          expect(Object.keys(node[1]).sort()).toEqual(Object.keys(from[index]![1]).sort());
        });
      });

      it("uses plain strokes in absolute coordinates on the 24 grid", () => {
        for (const nodes of states) {
          for (const node of nodes) {
            expect(TAGS.has(node[0]), node[0]).toBe(true);
            expect(node[1]).not.toHaveProperty("transform");
            if (node[0] === "path") {
              for (const command of parsePath(node[1].d ?? "")) {
                expect(command.letter, node[1].d).toMatch(/^[MLHVCSQTAZ]$/);
              }
            }
            for (const value of numbersOf(node)) {
              expect(value, JSON.stringify(node)).toBeGreaterThanOrEqual(0);
              expect(value, JSON.stringify(node)).toBeLessThanOrEqual(24);
            }
          }
        }
      });

      // Number-for-number interpolation then morphs without a matcher, in any runtime.
      it("pairs every path with the same commands, argument counts and arc flags", () => {
        const [from, to] = states as [ReadonlyArray<StrokeNode>, ReadonlyArray<StrokeNode>];
        from.forEach((node, index) => {
          const other = to[index]!;
          expect(numbersOf(other).length, `node ${index}`).toBe(numbersOf(node).length);
          if (node[0] !== "path") return;
          const a = parsePath(node[1].d ?? "");
          const b = parsePath(other[1].d ?? "");
          expect(b.map((command) => command.letter).join("")).toBe(
            a.map((command) => command.letter).join(""),
          );
          a.forEach((command, at) => {
            expect(b[at]!.args.length, `${node[1].d} @${at}`).toBe(command.args.length);
            if (command.letter === "A") {
              for (let arc = 0; arc < command.args.length; arc += 7) {
                expect(b[at]!.args.slice(arc + 3, arc + 5)).toEqual(
                  command.args.slice(arc + 3, arc + 5),
                );
              }
            }
          });
        });
      });
    });
  }
});
