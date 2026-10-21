import { describe, expect, it, vi } from "vite-plus/test";
import { closestCenter, type CollisionDetection } from "@dnd-kit/core";
import { verticalListSortingStrategy, type SortingStrategy } from "@dnd-kit/sortable";
import {
  createSidebarBranchCollisionDetection,
  createSidebarBranchDragGate,
  createSidebarCollisionDetection,
  createSidebarBranchSortingStrategy,
  createSidebarSortingStrategy,
  restrictBelowSidebarLabel,
} from "./Sidebar.drag";
import {
  resolveSidebarDropTarget,
  resolveSidebarBranchDragFeedback,
  resolveSidebarBranchDragVerb,
  resolveSidebarBranchDropTarget,
  planSidebarThreadDrop,
  sidebarBranchLaneId,
  sidebarListItemId,
  sidebarMarkerId,
  type SidebarListItem,
  type SidebarListMarker,
  type SidebarSection,
} from "./Sidebar.logic";

const thread = (key: string, section: SidebarSection): SidebarListItem => ({
  kind: "thread",
  key,
  section,
});
const marker = (marker: SidebarListMarker): SidebarListItem => ({ kind: "marker", marker });
const pinnedHeader = marker("pinned-header");
const divider = marker("pinned-divider");
const settledHeader = marker("settled-header");
const stationary = { x: 0, y: 0, scaleX: 1, scaleY: 1 };

describe("branch lane drops", () => {
  const activeOrder = ["a", "x", "b", "y", "c"];
  const laneKeyByThreadKey = new Map([
    ["a", "branch-a"],
    ["b", "branch-a"],
    ["c", "branch-a"],
    ["p", "branch-a"],
    ["s", "branch-a"],
    ["z", "branch-a"],
    ["x", "branch-x"],
    ["y", "branch-x"],
    ["foreign-pin", "branch-x"],
  ]);
  const items = [
    pinnedHeader,
    thread("p", "pinned"),
    thread("foreign-pin", "pinned"),
    divider,
    ...["a", "b", "c", "x", "y"].map((key) => thread(key, "active")),
    marker("snoozed-header"),
    thread("z", "snoozed"),
    settledHeader,
    thread("s", "settled"),
  ];
  const target = (activeKey: string, overId: string) =>
    resolveSidebarBranchDropTarget({
      items,
      activeKey,
      overId,
      laneKeyByThreadKey,
      activeOrder,
    });
  const plan = (
    activeKey: string,
    overId: string,
    overrides: Partial<Parameters<typeof planSidebarThreadDrop>[0]> = {},
  ) => {
    const destination = target(activeKey, overId);
    if (!destination) return { kind: "none" } as const;
    const source = items.find((item) => item.kind === "thread" && item.key === activeKey);
    if (source?.kind !== "thread") throw new Error("Missing test source");
    return planSidebarThreadDrop({
      activeKey,
      activeSection: source.section,
      target: destination,
      pinnedOrder: ["p", "foreign-pin"],
      pinnedKeysById: new Map([
        ["p", "f"],
        ["foreign-pin", "m"],
      ]),
      activeOrder,
      activeKeysById: new Map(
        activeOrder.map((key, index) => [key, ["a", "f", "m", "t", "z"][index]!]),
      ),
      ...overrides,
    });
  };

  it.each([
    ["a", "b", ["x", "b", "a", "y", "c"]],
    ["c", "b", ["a", "x", "c", "b", "y"]],
    ["a", "c", ["x", "b", "y", "c", "a"]],
    ["c", "header", ["c", "a", "x", "b", "y"]],
  ])("inserts %s between its lane neighbours in global order over %s", (key, over, order) => {
    const overId = over === "header" ? sidebarBranchLaneId("branch-a") : over;
    expect(target(key, overId)?.activeOrder).toEqual(order);
    expect(plan(key, overId)).toMatchObject({
      kind: "move-active",
      order,
      unpin: false,
      unsettle: false,
      unsnooze: false,
    });
  });

  it("writes only the moved active order assignment when there is room", () => {
    expect(plan("a", "b")).toEqual({
      kind: "move-active",
      order: ["x", "b", "a", "y", "c"],
      assignments: [{ id: "a", orderKey: "q" }],
      unpin: false,
      unsettle: false,
      unsnooze: false,
    });
  });

  it.each(["x", "header"])("rejects a foreign branch target %s", (over) => {
    const overId = over === "header" ? sidebarBranchLaneId("branch-x") : over;
    for (const source of ["a", "p", "s", "z"])
      expect(plan(source, overId)).toEqual({ kind: "none" });
    expect(plan("foreign-pin", "a")).toEqual({ kind: "none" });
  });

  it("preserves pin, settle, unpin, unsettle and wake actions", () => {
    expect(plan("a", sidebarMarkerId("pinned-header"))).toMatchObject({ kind: "pin" });
    expect(plan("a", sidebarMarkerId("settled-header"))).toEqual({ kind: "settle" });
    expect(plan("p", sidebarBranchLaneId("branch-a"))).toMatchObject({
      kind: "move-active",
      unpin: true,
    });
    expect(plan("s", "a")).toMatchObject({ kind: "move-active", unsettle: true });
    expect(plan("z", "a")).toMatchObject({ kind: "move-active", unsnooze: true });
  });

  it("rejects snoozed destinations, unknown lanes, and missing source keys", () => {
    for (const over of ["z", sidebarMarkerId("snoozed-header"), sidebarBranchLaneId("missing")]) {
      expect(target("a", over)).toBeNull();
    }
    expect(target("missing", "a")).toBeNull();
  });

  it("keeps scoped thread ids with the lane-header prefix draggable", () => {
    const key = "sidebar-branch-lane-env:a";
    expect(
      resolveSidebarBranchDropTarget({
        items: [pinnedHeader, divider, thread(key, "active"), thread("b", "active")],
        activeKey: "b",
        overId: key,
        laneKeyByThreadKey: new Map([
          [key, "branch-a"],
          ["b", "branch-a"],
        ]),
        activeOrder: [key, "b"],
      })?.activeOrder,
    ).toEqual(["b", key]);
  });

  it("keeps global order unchanged for a self drop or an unchanged first lane position", () => {
    expect(target("b", "b")?.activeOrder).toEqual(activeOrder);
    expect(plan("b", "b")).toEqual({ kind: "none" });
    expect(plan("a", sidebarBranchLaneId("branch-a"))).toEqual({ kind: "none" });
  });

  it("preserves active, pinned and settlement capability gates", () => {
    expect(plan("a", "b", { activeReorderableKeys: new Set(["b", "c", "x", "y"]) })).toEqual({
      kind: "none",
    });
    expect(
      plan("a", sidebarMarkerId("pinned-header"), {
        reorderableKeys: new Set(["p", "foreign-pin"]),
      }),
    ).toEqual({ kind: "none" });
    expect(plan("a", sidebarMarkerId("settled-header"), { supportsSettlement: false })).toEqual({
      kind: "none",
    });
    expect(plan("s", "a", { supportsSettlement: false })).toEqual({ kind: "none" });
  });
});

describe("branch lane sorting projection", () => {
  const items = [
    pinnedHeader,
    thread("p1", "pinned"),
    thread("p2", "pinned"),
    divider,
    thread("a1", "active"),
    thread("a2", "active"),
    thread("b", "active"),
    settledHeader,
    thread("s", "settled"),
  ];
  const strategy = () =>
    createSidebarBranchSortingStrategy({
      items,
      laneKeyByThreadKey: new Map([
        ["a1", "a"],
        ["a2", "a"],
        ["b", "b"],
      ]),
    });

  it.each([
    ["a1", "a2"],
    ["p1", "p2"],
  ])("uses vertical sorting within a lane from %s to %s", (active, over) => {
    const args = layout(items, active, over);
    expect(strategy()({ ...args, index: args.overIndex })).toEqual(
      verticalListSortingStrategy({ ...args, index: args.overIndex }),
    );
  });

  it.each([
    ["a1", "b"],
    ["a1", "p1"],
    ["p1", "a1"],
    ["a1", "s"],
  ])("does not shift rows across lanes from %s to %s", (active, over) => {
    const args = layout(items, active, over);
    expect(strategy()({ ...args, index: args.overIndex })).toBeNull();
  });
});

function layout(
  items: readonly SidebarListItem[],
  active: string,
  over: string,
  scale = 1,
  cardHeight = 82,
) {
  let top = 100;
  const rects = items.map((item) => {
    const height =
      item.kind === "thread"
        ? (item.section === "pinned" || item.section === "active" ? cardHeight : 36) * scale
        : item.marker === "pinned-header" || item.marker === "pinned-divider"
          ? 0
          : (item.marker.endsWith("placeholder") ? 0 : 32) * scale;
    const rect = { top, height, bottom: top + height, left: 0, right: 260, width: 260 };
    top += height + 1;
    return rect;
  });
  const activeIndex = items.findIndex((item) => sidebarListItemId(item) === active);
  return {
    activeIndex,
    overIndex: items.findIndex((item) => sidebarListItemId(item) === over),
    activeNodeRect: rects[activeIndex]!,
    rects,
    index: 0,
  } satisfies Parameters<SortingStrategy>[0];
}

function preview(
  input: Parameters<typeof createSidebarSortingStrategy>[0],
  active: string,
  over: string,
  scale = 1,
) {
  const strategy = createSidebarSortingStrategy(input);
  const args = layout(input.items, active, over, scale);
  return new Map(
    input.items.map((item, index) => [sidebarListItemId(item), strategy({ ...args, index })]),
  );
}

describe("sidebar collision detection", () => {
  function collisionArgs(blockedAboveSource = false) {
    const rows = [thread("source", "active"), thread("blocked", "active")];
    const items = [
      pinnedHeader,
      divider,
      ...(blockedAboveSource ? rows.toReversed() : rows),
      settledHeader,
      marker("settled-placeholder"),
    ];
    const { rects, activeIndex, overIndex } = layout(items, "source", "blocked");
    const collisionRect = rects[overIndex]!;
    return {
      active: {
        id: "source",
        data: { current: {} },
        rect: { current: { initial: rects[activeIndex]!, translated: collisionRect } },
      },
      collisionRect,
      droppableRects: new Map(items.map((item, index) => [sidebarListItemId(item), rects[index]!])),
      droppableContainers: items.map((item, index) => ({
        id: sidebarListItemId(item),
        key: sidebarListItemId(item),
        disabled: false,
        data: { current: {} },
        node: { current: null },
        rect: { current: rects[index]! },
      })),
      pointerCoordinates: null,
    } satisfies Parameters<CollisionDetection>[0];
  }

  it.each([
    [false, sidebarMarkerId("settled-header")],
    [true, sidebarMarkerId("pinned-divider")],
  ] as const)(
    "rejects unsupported Active instead of selecting %s / %s",
    (blockedAboveSource, nearbyTarget) => {
      const args = collisionArgs(blockedAboveSource);
      const detector = createSidebarCollisionDetection((id) => id !== "blocked");
      const filtered = closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter(
          (container) => container.id !== "blocked",
        ),
      });
      expect(filtered[0]?.id).toBe(nearbyTarget);
      expect(detector(args).map((collision) => collision.id)).toEqual(["source"]);
    },
  );

  it("selects the nearest supported target", () => {
    const detector = createSidebarCollisionDetection(() => true);
    expect(detector(collisionArgs())[0]?.id).toBe("blocked");
  });

  it.each([
    { sourceSection: "active", pins: 0 },
    { sourceSection: "active", pins: 1 },
    { sourceSection: "pinned", pins: 1 },
    { sourceSection: "settled", pins: 1 },
  ] as const)(
    "switches on crossing the divider row from $sourceSection with $pins pins",
    ({ sourceSection, pins }) => {
      const items = [
        pinnedHeader,
        ...(pins ? [thread("p", "pinned")] : []),
        ...(sourceSection === "pinned" ? [thread("source", "pinned")] : []),
        divider,
        thread("a", "active"),
        ...(sourceSection === "active" ? [thread("source", "active")] : []),
        settledHeader,
        ...(sourceSection === "settled" ? [thread("source", "settled")] : []),
      ];
      const { rects, activeIndex } = layout(items, "source", "a");
      const sourceRect = rects[activeIndex]!;
      let boundaryTop = 300;
      const boundaryNode = {
        querySelector: () => ({
          getBoundingClientRect: () => ({
            top: boundaryTop,
            bottom: boundaryTop + 16,
            left: 0,
            right: 260,
          }),
        }),
      } as unknown as HTMLElement;
      const detector = createSidebarCollisionDetection(() => true, {
        items,
        activationY: sourceSection === "pinned" ? 200 : 600,
      });
      const at = (center: number) => {
        const collisionRect = {
          ...sourceRect,
          top: center - sourceRect.height / 2,
          bottom: center + sourceRect.height / 2,
        };
        const args = {
          ...collisionArgs(),
          active: {
            id: "source",
            data: { current: {} },
            rect: { current: { initial: sourceRect, translated: collisionRect } },
          },
          collisionRect,
          pointerCoordinates: { x: 130, y: center },
          droppableRects: new Map(
            items.map((item, index) => [sidebarListItemId(item), rects[index]!]),
          ),
          droppableContainers: items.map((item, index) => ({
            id: sidebarListItemId(item),
            key: sidebarListItemId(item),
            disabled: false,
            data: { current: {} },
            node: {
              current:
                item === divider
                  ? boundaryNode
                  : item === settledHeader
                    ? ({ getBoundingClientRect: () => ({ top: 600 }) } as unknown as HTMLElement)
                    : null,
            },
            rect: { current: rects[index]! },
          })),
        };
        const over = detector(args)[0];
        return over ? resolveSidebarDropTarget(items, "source", String(over.id))?.section : null;
      };
      expect(at(330)).toBe("active");
      expect(at(317)).toBe("active");
      expect(at(316)).toBe("pinned");
      // The preview moves the divider; a stationary pointer must not undo the drop target.
      boundaryTop = 400;
      expect(at(316)).toBe("pinned");
      expect(at(399)).toBe("pinned");
      expect(at(400)).toBe("active");
      boundaryTop = 300;
      expect(at(400)).toBe("active");
      expect(at(317)).toBe("active");
      expect(at(316)).toBe("pinned");
    },
  );

  it("returns no collision if an unsupported target has no source fallback", () => {
    const args = collisionArgs();
    const detector = createSidebarCollisionDetection(() => false);
    expect(
      detector({
        ...args,
        droppableContainers: args.droppableContainers.filter(
          (container) => container.id !== "source",
        ),
      }),
    ).toEqual([]);
  });

  it("validates each hovered target once and always allows returning to the source", () => {
    const args = collisionArgs();
    const isValid = vi.fn((id: string) => id !== "blocked");
    const detector = createSidebarCollisionDetection(isValid);
    expect(detector(args)[0]?.id).toBe("source");
    expect(
      detector({
        ...args,
        collisionRect: {
          ...args.collisionRect,
          top: args.collisionRect.top + 3,
          bottom: args.collisionRect.bottom + 3,
        },
      })[0]?.id,
    ).toBe("source");
    expect(detector({ ...args, collisionRect: args.droppableRects.get("source")! })[0]?.id).toBe(
      "source",
    );
    expect(
      detector({
        ...args,
        collisionRect: args.droppableRects.get(sidebarMarkerId("settled-placeholder"))!,
      })[0]?.id,
    ).toBe(sidebarMarkerId("settled-placeholder"));
    expect(isValid.mock.calls).toEqual([["blocked"], [sidebarMarkerId("settled-placeholder")]]);
  });
});

describe("sidebar drag projection", () => {
  it.each([
    ["a1", "a2"],
    ["a1", sidebarMarkerId("settled-header")],
    ["z", "a2"],
  ])("keeps sparse shelves at the bottom when dragging %s over %s", (active, over) => {
    const items = [
      pinnedHeader,
      divider,
      thread("a1", "active"),
      thread("a2", "active"),
      marker("snoozed-header"),
      thread("z", "snoozed"),
      settledHeader,
      thread("s", "settled"),
    ];
    const strategy = createSidebarSortingStrategy({
      items,
      settledOrder: over === sidebarMarkerId("settled-header") ? ["a1", "s"] : ["s"],
      settledExpanded: true,
      boundaryLabelHeight: 24,
      snoozedThreadCount: 1,
    });
    const args = layout(items, active, over);
    for (const rect of args.rects.slice(4)) {
      rect.top += 400;
      rect.bottom += 400;
    }
    const lastIndex = items.length - 1;
    expect(strategy({ ...args, index: lastIndex })).toEqual(stationary);
  });

  const pinned = [
    pinnedHeader,
    thread("p1", "pinned"),
    thread("p2", "pinned"),
    divider,
    thread("a1", "active"),
    settledHeader,
    thread("s1", "settled"),
  ];

  it.each([
    ["p1", "p2"],
    ["p2", "p1"],
  ])("preserves existing pinned transforms from %s to %s", (active, over) => {
    const strategy = createSidebarSortingStrategy({
      items: pinned,
      settledOrder: [],
      settledExpanded: true,
    });
    const args = layout(pinned, active, over);
    // dnd-kit moves the lifted row by the pointer delta, so only peers matter.
    for (let index = 0; index < pinned.length; index += 1) {
      if (index === args.activeIndex) continue;
      expect(strategy({ ...args, index })).toEqual(verticalListSortingStrategy({ ...args, index }));
    }
  });

  it("keeps the pinned header above the gap when a lower pin moves to the top", () => {
    const result = preview(
      { items: pinned, settledOrder: [], settledExpanded: true },
      "p2",
      sidebarMarkerId("pinned-header"),
    );
    expect(result.get(sidebarMarkerId("pinned-header"))).toEqual(stationary);
    expect(result.get("p1")).toEqual({ ...stationary, y: 83 });
    expect(result.get(sidebarMarkerId("pinned-divider"))).toEqual(stationary);
    expect(result.get("a1")).toEqual(stationary);
  });

  it.each([
    ["a1", "a2"],
    ["a2", "a1"],
  ])("uses pinned dragging behavior for Active from %s to %s", (active, over) => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a1", "active"),
      thread("a2", "active"),
      settledHeader,
      thread("s", "settled"),
    ];
    const strategy = createSidebarSortingStrategy({
      items,
      settledOrder: [],
      settledExpanded: true,
    });
    const args = layout(items, active, over);
    for (let index = 0; index < items.length; index += 1) {
      if (index === args.activeIndex) continue;
      expect(strategy({ ...args, index })).toEqual(verticalListSortingStrategy({ ...args, index }));
    }
  });

  it("preserves settled order while opening the zero-height Active target", () => {
    const items = [
      pinnedHeader,
      divider,
      marker("active-placeholder"),
      settledHeader,
      thread("first", "settled"),
      thread("second", "settled"),
    ];
    const result = preview(
      { items, settledOrder: ["first", "second"], settledExpanded: true },
      "second",
      "first",
    );
    expect(result.get(sidebarMarkerId("active-placeholder"))).toEqual(stationary);
    expect(result.get(sidebarMarkerId("settled-header"))).toEqual({ ...stationary, y: 36 });
    expect(result.get("first")).toEqual({ ...stationary, y: 36 });
    expect(result.get("second")).toEqual(stationary);
  });

  it.each([
    [sidebarMarkerId("pinned-divider"), 0, 0],
    ["a1", -83, 0],
    ["a2", -83, -83],
  ] as const)(
    "opens the active pointer slot over %s without adding an empty pinned row",
    (over, a1Offset, a2Offset) => {
      const items = [
        pinnedHeader,
        thread("p", "pinned"),
        divider,
        thread("a1", "active"),
        thread("a2", "active"),
        settledHeader,
        thread("s", "settled"),
      ];
      const result = preview({ items, settledOrder: [], settledExpanded: true }, "p", over);
      expect(result.get(sidebarMarkerId("pinned-header"))).toEqual(stationary);
      expect(result.get(sidebarMarkerId("pinned-divider"))?.y).toBe(-83);
      expect(result.get("a1")?.y).toBe(a1Offset);
      expect(result.get("a2")?.y).toBe(a2Offset);
      expect(result.get(sidebarMarkerId("settled-header"))?.y).toBe(0);
    },
  );

  it("opens label space below each pinned boundary while dragging", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a1", "active"),
      thread("a2", "active"),
      settledHeader,
      thread("s", "settled"),
    ];
    // Reorder inside active: the header gap shifts every row, the divider
    // gap shifts the active rows and the shelf below by a second label.
    const result = preview(
      { items, settledOrder: [], settledExpanded: true, boundaryLabelHeight: 16 },
      "a2",
      "a1",
    );
    expect(result.get(sidebarMarkerId("pinned-header"))).toEqual(stationary);
    expect(result.get("p")?.y).toBe(16);
    expect(result.get(sidebarMarkerId("pinned-divider"))?.y).toBe(16);
    expect(result.get("a2")).toEqual(stationary);
    expect(result.get("a1")?.y).toBe(32 + 83);
    expect(result.get(sidebarMarkerId("settled-header"))?.y).toBe(32);
    expect(result.get("s")?.y).toBe(32);
  });

  it.each(["s1", "missing-target"])(
    "keeps label clearance when a settled drag is over %s",
    (over) => {
      const items = [
        pinnedHeader,
        thread("p", "pinned"),
        divider,
        thread("a", "active"),
        settledHeader,
        thread("s1", "settled"),
        thread("s2", "settled"),
      ];
      const result = preview(
        {
          items,
          settledOrder: ["s1", "s2"],
          settledExpanded: true,
          boundaryLabelHeight: 24,
        },
        "s2",
        over,
      );
      expect(result.get("p")?.y).toBe(24);
      expect(result.get(sidebarMarkerId("pinned-divider"))?.y).toBe(24);
      expect(result.get("a")?.y).toBe(48);
      expect(result.get("s1")?.y).toBe(48);
      expect(result.get("s2")).toEqual(stationary);
    },
  );

  it("stacks the labels with their gaps when the pinned section is empty", () => {
    const items = [
      pinnedHeader,
      divider,
      thread("a1", "active"),
      thread("a2", "active"),
      settledHeader,
      thread("s", "settled"),
    ];
    const result = preview(
      { items, settledOrder: [], settledExpanded: true, boundaryLabelHeight: 16 },
      "a2",
      "a1",
    );
    expect(result.get(sidebarMarkerId("pinned-header"))).toEqual(stationary);
    expect(result.get(sidebarMarkerId("pinned-divider"))?.y).toBe(16);
    expect(result.get("a1")?.y).toBe(32 + 83);
    expect(result.get(sidebarMarkerId("settled-header"))?.y).toBe(32);
  });

  it("scales the label space with the measured root scale", () => {
    const items = [pinnedHeader, thread("p", "pinned"), divider, thread("a1", "active")];
    const result = preview(
      { items, settledOrder: [], settledExpanded: true, boundaryLabelHeight: 16 },
      "a1",
      "p",
      2,
    );
    expect(result.get(sidebarMarkerId("pinned-divider"))?.y).toBe(32 + 165);
  });

  it("keeps the pinned header above the first arriving pin", () => {
    const items = [
      pinnedHeader,
      divider,
      thread("a1", "active"),
      thread("a2", "active"),
      settledHeader,
      thread("s", "settled"),
    ];
    const result = preview(
      { items, settledOrder: [], settledExpanded: true },
      "a2",
      sidebarMarkerId("pinned-header"),
    );
    expect(result.get(sidebarMarkerId("pinned-header"))).toEqual(stationary);
    expect(result.get(sidebarMarkerId("pinned-divider"))?.y).toBe(83);
    expect(result.get("a1")?.y).toBe(83);
    expect(result.get(sidebarMarkerId("settled-header"))?.y).toBe(0);
  });

  it.each([
    ["p", -83, -1],
    ["s", 0, 82],
  ] as const)(
    "replaces the empty Active target when %s enters",
    (active, dividerOffset, settledOffset) => {
      const items = [
        pinnedHeader,
        thread("p", "pinned"),
        divider,
        marker("active-placeholder"),
        settledHeader,
        thread("s", "settled"),
      ];
      const result = preview(
        { items, settledOrder: [], settledExpanded: true },
        active,
        sidebarMarkerId("active-placeholder"),
      );
      expect(result.get(sidebarMarkerId("active-placeholder"))?.scaleY).toBe(0);
      expect(result.get(sidebarMarkerId("pinned-divider"))?.y).toBe(dividerOffset);
      expect(result.get(sidebarMarkerId("settled-header"))?.y).toBe(settledOffset);
    },
  );

  it("uses the canonical settled rank and the destination's slim height", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a", "active"),
      settledHeader,
      thread("s1", "settled"),
      thread("s2", "settled"),
    ];
    const result = preview(
      { items, settledOrder: ["s1", "a", "s2"], settledExpanded: true },
      "a",
      "s2",
    );
    expect(result.get(sidebarMarkerId("settled-header"))?.y).toBe(-46);
    expect(result.get("s1")?.y).toBe(-46);
    expect(result.get("s2")?.y).toBe(-9);
  });

  it.each([
    ["a1", 83],
    ["a2", 0],
  ] as const)(
    "reserves a full card at the pointer slot over %s when a slim row enters Active",
    (over, firstOffset) => {
      const items = [
        pinnedHeader,
        thread("p", "pinned"),
        divider,
        thread("a1", "active"),
        thread("a2", "active"),
        settledHeader,
        thread("s", "settled"),
      ];
      const result = preview({ items, settledOrder: [], settledExpanded: true }, "s", over);
      expect(result.get("a1")?.y).toBe(firstOffset);
      expect(result.get("a2")?.y).toBe(83);
      expect(result.get(sidebarMarkerId("settled-header"))?.y).toBe(83);
    },
  );

  it("removes the snoozed header when its last row leaves", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a", "active"),
      marker("snoozed-header"),
      thread("z", "snoozed"),
      settledHeader,
      thread("s", "settled"),
    ];
    const result = preview({ items, settledOrder: [], settledExpanded: true }, "z", "a");
    expect(result.get(sidebarMarkerId("snoozed-header"))?.scaleY).toBe(0);
    expect(result.get(sidebarMarkerId("settled-header"))?.y).toBe(13);
    expect(result.get("s")?.y).toBe(13);
  });

  it("keeps a collapsed settled target without inserting a hidden row", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a1", "active"),
      thread("a2", "active"),
      settledHeader,
      marker("settled-placeholder"),
    ];
    const result = preview(
      { items, settledOrder: [], settledExpanded: false },
      "a2",
      sidebarMarkerId("settled-placeholder"),
    );
    expect(result.get(sidebarMarkerId("settled-header"))?.y).toBe(-83);
    expect(result.get(sidebarMarkerId("settled-placeholder"))).toEqual({ ...stationary, y: -83 });
  });

  it("preserves a collapsed snoozed header while another section changes", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a", "active"),
      marker("snoozed-header"),
      settledHeader,
      marker("settled-placeholder"),
    ];
    const result = preview(
      { items, settledOrder: [], settledExpanded: false },
      "a",
      sidebarMarkerId("settled-placeholder"),
    );
    expect(result.get(sidebarMarkerId("snoozed-header"))).toEqual({ ...stationary, y: -46 });
  });

  it("derives missing card geometry from the measured root scale", () => {
    const items = [
      pinnedHeader,
      divider,
      marker("active-placeholder"),
      settledHeader,
      thread("s", "settled"),
    ];
    const result = preview(
      { items, settledOrder: [], settledExpanded: true },
      "s",
      sidebarMarkerId("pinned-header"),
      0.75,
    );
    expect(result.get(sidebarMarkerId("pinned-header"))).toEqual(stationary);
    expect(result.get(sidebarMarkerId("pinned-divider"))?.y).toBe(62.5);
    expect(result.get(sidebarMarkerId("active-placeholder"))?.y).toBe(62.5);
  });

  it("updates the projection when the target or measured geometry changes", () => {
    const strategy = createSidebarSortingStrategy({
      items: pinned,
      settledOrder: [],
      settledExpanded: true,
    });
    const args = layout(pinned, "p1", "p1");
    expect(strategy({ ...args, index: 2 })?.y).toBe(0);
    expect(strategy({ ...args, index: 2, overIndex: 4 })?.y).toBe(-83);
    const smaller = layout(pinned, "p1", "a1", 0.75);
    expect(strategy({ ...smaller, index: 2 })?.y).toBe(-62.5);
  });

  it.each(["active", "settled"] as const)(
    "reveals the mounted empty %s target when its last row leaves and hides it on return",
    (section) => {
      const items = [
        pinnedHeader,
        thread("p", "pinned"),
        divider,
        marker("active-placeholder"),
        thread("a", "active"),
        settledHeader,
        marker("settled-placeholder"),
        thread("s", "settled"),
      ];
      const active = section === "active" ? "a" : "s";
      const input = { items, settledOrder: ["s"], settledExpanded: true };
      const placeholderId = sidebarMarkerId(`${section}-placeholder`);
      const resting = preview(input, active, active);
      expect(resting.get(placeholderId)?.scaleY).toBe(0);
      const leaving = preview(input, active, sidebarMarkerId("pinned-header"));
      expect(leaving.get(placeholderId)?.scaleY).toBe(1);
      const returning = preview(input, active, active);
      expect(returning.get(placeholderId)?.scaleY).toBe(0);
    },
  );

  it("uses shelf height for empty target sizing when card height differs from its default", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a", "active"),
      settledHeader,
      marker("settled-placeholder"),
    ];
    const strategy = createSidebarSortingStrategy({
      items,
      settledOrder: [],
      settledExpanded: false,
    });
    const args = layout(items, "a", sidebarMarkerId("settled-placeholder"), 1, 78);
    expect(strategy({ ...args, index: 4 })?.y).toBe(-42);
  });

  it("keeps the route row visible after a settled drop pushes it beyond the page", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a", "active"),
      settledHeader,
      thread("s", "settled"),
    ];
    const input = {
      items,
      settledOrder: ["a", "s", "hidden"],
      settledExpanded: true,
      settledVisibleCount: 1,
    };
    const withRoute = preview({ ...input, routeThreadKey: "s" }, "a", "s");
    const withoutRoute = preview(input, "a", "s");
    expect(withRoute.get("s")).toEqual({ ...stationary, y: -9 });
    expect(withoutRoute.get("s")?.scaleY).toBe(0);
  });

  it("reserves the next page row when a visible settled thread leaves", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a", "active"),
      settledHeader,
      thread("s1", "settled"),
      thread("route", "settled"),
    ];
    const result = preview(
      {
        items,
        settledOrder: ["s1", "hidden", "route"],
        settledExpanded: true,
        settledVisibleCount: 1,
        routeThreadKey: "route",
      },
      "s1",
      "a",
    );
    expect(result.get(sidebarMarkerId("settled-header"))?.y).toBe(83);
    expect(result.get("route")?.y).toBe(83);
  });

  it("keeps the dropped route thread visible in a collapsed settled shelf", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a", "active"),
      settledHeader,
      marker("settled-placeholder"),
    ];
    const result = preview(
      {
        items,
        settledOrder: ["a", "hidden"],
        settledExpanded: false,
        settledVisibleCount: 1,
        routeThreadKey: "a",
      },
      "a",
      sidebarMarkerId("settled-placeholder"),
    );
    expect(result.get(sidebarMarkerId("settled-placeholder"))?.scaleY).toBe(0);
    expect(result.get(sidebarMarkerId("settled-header"))?.y).toBe(-46);
  });

  it("preserves hidden snoozed membership when the only rendered route row leaves", () => {
    const items = [
      pinnedHeader,
      thread("p", "pinned"),
      divider,
      thread("a", "active"),
      marker("snoozed-header"),
      thread("z", "snoozed"),
      settledHeader,
      thread("s", "settled"),
    ];
    const result = preview(
      {
        items,
        settledOrder: ["s"],
        settledExpanded: true,
        snoozedThreadCount: 2,
      },
      "z",
      "a",
    );
    expect(result.get(sidebarMarkerId("snoozed-header"))).toEqual({ ...stationary, y: 83 });
    expect(result.get(sidebarMarkerId("settled-header"))?.y).toBe(46);
  });
});

describe("lifted card clearance", () => {
  const rect = (top: number, height: number) => ({
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 260,
    width: 260,
  });
  const apply = (cardTop: number, cardHeight: number, y: number, listTop = 136, offset = 32) =>
    restrictBelowSidebarLabel(
      {
        transform: { ...stationary, y },
        containerNodeRect: rect(listTop, 500),
        draggingNodeRect: rect(cardTop, cardHeight),
        activatorEvent: null,
        active: null,
        activeNodeRect: null,
        over: null,
        overlayNodeRect: null,
        scrollableAncestors: [],
        scrollableAncestorRects: [],
        windowRect: null,
      },
      offset,
    );

  it.each([36, 82])("keeps a %ipx row below empty Pins even past the top edge", (height) => {
    for (const pointerY of [150, 136, 100, 0]) {
      const transform = apply(511, height, pointerY - 529);
      expect(511 + transform.y).toBe(168);
    }
  });

  it("preserves pointer movement below the label", () => {
    expect(apply(511, 36, -200).y).toBe(-200);
  });

  it("follows the list when it scrolls and includes content preceding Pins", () => {
    expect(511 + apply(511, 36, -500, 96).y).toBe(128);
    expect(511 + apply(511, 36, -500, 136, 114).y).toBe(250);
  });
});

describe("branch collision detection", () => {
  const pinnedLane = sidebarMarkerId("pinned-header");
  const laneA = sidebarBranchLaneId("a");
  const laneB = sidebarBranchLaneId("b");
  const box = (top: number, height: number) => ({
    top,
    bottom: top + height,
    left: 0,
    right: 300,
    width: 300,
    height,
  });
  const rects: Record<string, ReturnType<typeof box>> = {
    [pinnedLane]: box(0, 130),
    p1: box(28, 48),
    p2: box(78, 48),
    [laneA]: box(140, 130),
    a1: box(168, 48),
    a2: box(218, 48),
    [laneB]: box(280, 80),
    b1: box(308, 48),
  };
  const laneRows = new Map([
    [pinnedLane, ["p1", "p2"]],
    [laneA, ["a1", "a2"]],
    [laneB, ["b1"]],
  ]);
  const argsAt = (y: number, layout = rects) =>
    ({
      active: {
        id: "a2",
        data: { current: {} },
        rect: { current: { initial: layout.a2!, translated: layout.a2! } },
      },
      collisionRect: layout.a2!,
      droppableRects: new Map(Object.entries(layout)),
      droppableContainers: Object.entries(layout).map(([id, rect]) => ({
        id,
        key: id,
        disabled: false,
        data: { current: {} },
        node: { current: null },
        rect: { current: rect },
      })),
      pointerCoordinates: { x: 100, y },
    }) satisfies Parameters<CollisionDetection>[0];
  const detector = (
    options: {
      isValidTarget?: (id: string) => boolean;
      laneRows?: ReadonlyMap<string, readonly string[]>;
    } = {},
  ) => {
    const gate = createSidebarBranchDragGate();
    const detect = createSidebarBranchCollisionDetection({
      laneRows: options.laneRows ?? laneRows,
      gate,
      isValidTarget: options.isValidTarget ?? (() => true),
    });
    return (y: number, layout = rects) => detect(argsAt(y, layout)).map(({ id }) => id);
  };
  // The first call anchors the gate far below every lane.
  const released = (options?: Parameters<typeof detector>[0]) => {
    const at = detector(options);
    at(1_000);
    return at;
  };

  it("keeps the picked-up row as its target until the pointer moves", () => {
    const at = detector();
    // Pickup mounted Drop to pin above every lane, so p2 slid under the pointer.
    expect(at(100)).toEqual(["a2"]);
    expect(at(104)).toEqual(["a2"]);
    expect(at(190)).toEqual(["a1"]);
    expect(at(100)).toEqual(["p2"]);
  });

  it("picks pinned rows over the Pinned lane around them", () => {
    const at = released();
    expect(at(50)).toEqual(["p1"]);
    expect(at(100)).toEqual(["p2"]);
  });

  it("maps a lane header, row gap or gutter to that lane's nearest row", () => {
    const at = released();
    expect(at(150)).toEqual(["a1"]);
    expect(at(268)).toEqual(["a2"]);
    expect(at(290)).toEqual(["b1"]);
  });

  it("targets an empty lane itself", () => {
    const { p1: _p1, p2: _p2, ...withoutPins } = rects;
    const at = released({ laneRows: new Map([...laneRows, [pinnedLane, []]]) });
    expect(at(50, withoutPins)).toEqual([pinnedLane]);
  });

  it("falls back to the dragged row for targets the server would refuse", () => {
    const at = released({ isValidTarget: (id) => id !== "b1" });
    expect(at(330)).toEqual(["a2"]);
    expect(at(190)).toEqual(["a1"]);
  });

  it("returns nothing outside every lane", () => {
    expect(released()(375)).toEqual([]);
  });
});

describe("branch drag feedback", () => {
  const laneKeyByThreadKey = new Map([
    ["a", "branch-a"],
    ["b", "branch-a"],
    ["p", "branch-a"],
    ["z", "branch-a"],
    ["x", "branch-x"],
    ["s", "branch-x"],
  ]);
  const items = [
    pinnedHeader,
    thread("p", "pinned"),
    divider,
    ...["a", "b", "x"].map((key) => thread(key, "active")),
    marker("snoozed-header"),
    thread("z", "snoozed"),
    settledHeader,
    thread("s", "settled"),
  ];
  const feedback = (activeKey: string, overId: string | null) => {
    const { target, overLaneKey, rejectedLaneKey } = resolveSidebarBranchDragFeedback({
      items,
      activeKey,
      overId,
      laneKeyByThreadKey,
      activeOrder: ["a", "b", "x"],
    });
    return { section: target?.section ?? null, overLaneKey, rejectedLaneKey };
  };

  it("highlights the source lane for an in-lane move", () => {
    expect(feedback("a", "b")).toEqual({
      section: "active",
      overLaneKey: "branch-a",
      rejectedLaneKey: null,
    });
  });

  it("rejects another branch lane, by row or by lane wrapper", () => {
    const rejected = { section: null, overLaneKey: "branch-x", rejectedLaneKey: "branch-x" };
    expect(feedback("a", "x")).toEqual(rejected);
    expect(feedback("a", sidebarBranchLaneId("branch-x"))).toEqual(rejected);
  });

  it("never names a branch lane for pinned, snoozed or settled rows", () => {
    expect(feedback("p", "p")).toEqual({
      section: "pinned",
      overLaneKey: null,
      rejectedLaneKey: null,
    });
    expect(feedback("x", "z")).toEqual({ section: null, overLaneKey: null, rejectedLaneKey: null });
    expect(feedback("a", "s").overLaneKey).toBeNull();
    expect(feedback("a", null)).toEqual({
      section: null,
      overLaneKey: null,
      rejectedLaneKey: null,
    });
  });

  it.each([
    [{ sourceSection: "active", targetSection: "active", rejected: true }, "Can't move here"],
    [{ sourceSection: "active", targetSection: null, rejected: false }, null],
    [{ sourceSection: "active", targetSection: "pinned", rejected: false }, "Pin"],
    [{ sourceSection: "pinned", targetSection: "pinned", rejected: false }, "Move"],
    [{ sourceSection: "active", targetSection: "settled", rejected: false }, "Settle"],
    [{ sourceSection: "settled", targetSection: "settled", rejected: false }, "Move"],
    [{ sourceSection: "snoozed", targetSection: "active", rejected: false }, "Wake"],
    [{ sourceSection: "settled", targetSection: "active", rejected: false }, "Move"],
  ] as const)("labels the chip for %j as %s", (input, verb) => {
    expect(resolveSidebarBranchDragVerb({ ...input, overSelf: false })).toBe(verb);
  });

  it("shows no verb over the row's own slot, where refused targets also land", () => {
    for (const sourceSection of ["active", "pinned", "snoozed"] as const) {
      expect(
        resolveSidebarBranchDragVerb({
          sourceSection,
          targetSection: sourceSection === "snoozed" ? null : sourceSection,
          rejected: false,
          overSelf: true,
        }),
      ).toBeNull();
    }
  });
});
