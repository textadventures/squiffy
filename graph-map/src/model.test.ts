import { describe, expect, test } from "vitest";
import { layeredLayout } from "./layout.js";
import { MapModel } from "./model.js";
import type { MapEdge, MapNode } from "./types.js";

interface Node extends MapNode {
    rank?: number;
    parent?: string;
    group?: number;
}

const node = (id: string, rank?: number, extra: Partial<Node> = {}): Node => ({ id, label: id, width: 100, height: 30, rank, ...extra });
const edge = (from: string, to: string): MapEdge => ({ id: `${from}->${to}`, from, to });

const layout = () => layeredLayout<Node, MapEdge>({ rank: n => n.rank, parent: n => n.parent, group: n => n.group ?? 0 });

// A start, two choices, each with two outcomes, and a passage
const story = {
    nodes: [
        node("start", 0), node("left", 1), node("right", 1),
        node("l1", 2), node("l2", 2), node("r1", 2), node("r2", 2),
        node("look", undefined, { parent: "start", width: 40, height: 20 }),
    ],
    edges: [edge("start", "left"), edge("start", "right"), edge("left", "l1"), edge("left", "l2"), edge("right", "r1"), edge("right", "r2"), edge("start", "look")],
};

function settle(model: MapModel<Node>) {
    let ticks = 0;
    while (!model.settled && ticks++ < 2000) model.step(1000, 1);
}

const positions = (model: MapModel<Node>) => Object.fromEntries([...model.nodes].map(([id, n]) => [id, [Math.round(n.x), Math.round(n.y)]]));

describe("layered layout", () => {
    test("rows read from the top, in rank order, with children under their parents", () => {
        const model = new MapModel(layout());
        model.update(story);
        settle(model);
        const y = (id: string) => model.position(id)!.y;
        const x = (id: string) => model.position(id)!.x;
        expect(y("start")).toBeLessThan(y("left"));
        expect(Math.abs(y("left") - y("right"))).toBeLessThan(30);
        expect(y("left")).toBeLessThan(y("l1"));
        // The left branch stays on the left
        expect(x("l1")).toBeLessThan(x("r1"));
        expect(x("l2")).toBeLessThan(x("r2"));
        // The passage hangs just under its section
        expect(y("look")).toBeGreaterThan(y("start"));
        expect(y("look") - y("start")).toBeLessThan(60);
        expect(Math.abs(x("look") - x("start"))).toBeLessThan(60);
    });

    test("boxes don't overlap", () => {
        const model = new MapModel(layout());
        model.update(story);
        settle(model);
        const nodes = [...model.nodes.values()];
        for (const a of nodes) {
            for (const b of nodes) {
                if (a === b) continue;
                const overlapX = (a.width + b.width) / 2 - Math.abs(a.x - b.x);
                const overlapY = (a.height + b.height) / 2 - Math.abs(a.y - b.y);
                expect(overlapX > 0 && overlapY > 0, `${a.id} and ${b.id} overlap`).toBe(false);
            }
        }
    });

    test("deterministic: the same graph gives the same map", () => {
        const a = new MapModel(layout()), b = new MapModel(layout());
        a.update(story);
        b.update({ nodes: story.nodes.map(n => ({ ...n })), edges: story.edges.map(e => ({ ...e })) });
        settle(a);
        settle(b);
        expect(positions(a)).toEqual(positions(b));
    });

    test("groups start side by side", () => {
        const model = new MapModel(layout());
        model.update({ nodes: [node("a", 0), node("b", 1), node("lost", 0, { group: 1 })], edges: [edge("a", "b")] });
        const placed = positions(model);
        expect(placed.lost[0]).toBeGreaterThan(placed.a[0] + 100);
    });
});

describe("stability", () => {
    test("adding a node moves only it and what it's linked to", () => {
        const model = new MapModel(layout());
        model.update(story);
        settle(model);
        const before = positions(model);
        model.update({ nodes: [...story.nodes, node("l3", 3)], edges: [...story.edges, edge("l1", "l3")] });
        settle(model);
        const after = positions(model);
        for (const id of ["start", "left", "right", "l2", "r1", "r2", "look"]) expect(after[id]).toEqual(before[id]);
        expect(after.l3[1]).toBeGreaterThan(after.l1[1]);
    });

    test("an edit that adds no nodes moves nothing", () => {
        const model = new MapModel(layout());
        model.update(story);
        settle(model);
        model.update({ nodes: story.nodes, edges: [...story.edges, edge("r2", "start")] });
        expect(model.settled).toBe(true);
    });

    test("pinned nodes stay where they're pinned", () => {
        const model = new MapModel(layout());
        model.update(story, new Map([["right", { x: 500, y: 40 }]]));
        settle(model);
        expect(model.position("right")).toMatchObject({ x: 500, y: 40 });
        expect(model.isPinned("right")).toBe(true);
    });

    test("a dragged node is pinned where it's dropped, and its neighbours follow while it's dragged", () => {
        const model = new MapModel(layout());
        model.update(story);
        settle(model);
        const l1 = { ...model.position("l1")! };
        model.startDrag("left");
        for (let i = 0; i < 30; i++) {
            model.drag("left", { x: -400, y: 300 });
            model.step(1000, 1);
        }
        expect(model.endDrag().get("left")).toEqual({ x: -400, y: 300 });
        expect(model.position("l1")!.x).toBeLessThan(l1.x - 20);
        settle(model);
        expect(model.position("left")).toMatchObject({ x: -400, y: 300 });
    });

    test("dragging moves only what's linked to the dragged node, and the rest stays put", () => {
        const model = new MapModel(layout());
        model.update(story);
        settle(model);
        const before = positions(model);
        model.startDrag("left");
        for (let i = 0; i < 60; i++) {
            model.drag("left", { x: -500, y: 120 });
            model.step(1000, 1);
        }
        model.endDrag();
        settle(model);
        const after = positions(model);
        // Not linked to left: held still, rather than spreading into the space it left
        for (const id of ["right", "r1", "r2"]) expect(after[id]).toEqual(before[id]);
        // Linked to it: followed it
        expect(after.l1[0]).toBeLessThan(before.l1[0] - 20);
        // Once settled, the neighbours stay where they got to, the next time anything moves
        const l1 = after.l1;
        model.startDrag("r2");
        model.drag("r2", { x: 600, y: 300 });
        model.endDrag();
        settle(model);
        expect(positions(model).l1).toEqual(l1);
    });

    test("a node linked to others doesn't follow a dragged one, but one linked only to it does", () => {
        const model = new MapModel(layout());
        // hub is linked from both left and right; leaf only from left
        const graph = { nodes: [...story.nodes, node("hub", 3), node("leaf", 2)], edges: [...story.edges, edge("left", "hub"), edge("right", "hub"), edge("left", "leaf")] };
        model.update(graph);
        settle(model);
        const before = positions(model);
        model.startDrag("left");
        for (let i = 0; i < 60; i++) {
            model.drag("left", { x: -600, y: 120 });
            model.step(1000, 1);
        }
        model.endDrag();
        settle(model);
        const after = positions(model);
        expect(after.hub).toEqual(before.hub);
        expect(after.start).toEqual(before.start);
        expect(after.leaf[0]).toBeLessThan(before.leaf[0] - 50);
    });

    test("several nodes dragged together keep their places relative to each other, and are all pinned", () => {
        const model = new MapModel(layout());
        model.update(story);
        settle(model);
        const before = positions(model);
        model.startDrag(["left", "right"]);
        model.drag("left", { x: model.position("left")!.x + 100, y: model.position("left")!.y + 50 });
        const dropped = model.endDrag();
        expect([...dropped.keys()].sort()).toEqual(["left", "right"]);
        settle(model);
        const after = positions(model);
        for (const id of ["left", "right"]) {
            expect(after[id][0] - before[id][0]).toBeCloseTo(100, -1);
            expect(after[id][1] - before[id][1]).toBeCloseTo(50, -1);
            expect(model.isPinned(id)).toBe(true);
        }
    });

    test("a renamed node keeps its place", () => {
        const model = new MapModel(layout());
        model.update(story);
        settle(model);
        const at = { ...model.position("left")! };
        model.rename("left", "west");
        model.update({ nodes: story.nodes.map(n => n.id == "left" ? { ...n, id: "west" } : n), edges: story.edges.map(e => e.from == "left" ? { ...e, from: "west" } : e.to == "left" ? { ...e, to: "west" } : e) });
        expect(model.position("west")).toMatchObject({ x: at.x, y: at.y });
        expect(model.settled).toBe(true);
    });

    test("relayout forgets positions that aren't pinned", () => {
        const model = new MapModel(layout());
        model.update(story);
        settle(model);
        const original = positions(model);
        model.startDrag("left");
        model.drag("left", { x: -400, y: 300 });
        model.endDrag();
        settle(model);
        model.relayout(new Map());
        settle(model);
        expect(positions(model)).toEqual(original);
    });
});
