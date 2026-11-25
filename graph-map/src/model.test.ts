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

// A long story: a chain of `length` nodes, each linking to the next
function chain(length: number, prefix = "c") {
    const nodes = Array.from({ length }, (_, i) => node(`${prefix}${i}`, i));
    const edges = nodes.slice(1).map((n, i) => edge(nodes[i].id, n.id));
    return { nodes, edges };
}

function bounds(model: MapModel<Node>) {
    const nodes = [...model.nodes.values()];
    const width = Math.max(...nodes.map(n => n.x + n.width / 2)) - Math.min(...nodes.map(n => n.x - n.width / 2));
    const height = Math.max(...nodes.map(n => n.y + n.height / 2)) - Math.min(...nodes.map(n => n.y - n.height / 2));
    return { width, height };
}

describe("folding", () => {
    test("rows that would make a tall, thin map fold into columns side by side", () => {
        const model = new MapModel(layout());
        model.update(chain(60));
        settle(model);
        const { width, height } = bounds(model);
        expect(width / height).toBeGreaterThan(0.8);
        expect(width / height).toBeLessThan(3);
        const x = (i: number) => model.position(`c${i}`)!.x;
        const y = (i: number) => model.position(`c${i}`)!.y;
        // Each column reads from the top, and the next one starts at the top again, to the right
        const tops = [...Array(60).keys()].filter(i => i > 0 && y(i) < y(i - 1));
        expect(tops.length).toBeGreaterThan(1);
        for (const i of tops) expect(x(i)).toBeGreaterThan(x(i - 1) + 100);
        for (let i = 1; i < 60; i++) if (!tops.includes(i)) expect(y(i)).toBeGreaterThan(y(i - 1));
    });

    test("a map that's already wide enough doesn't fold", () => {
        const model = new MapModel(layout());
        model.update(story);
        settle(model);
        expect(model.position("l1")!.y).toBeGreaterThan(model.position("left")!.y);
        expect(model.position("left")!.y).toBeGreaterThan(model.position("start")!.y);
    });

    test("aspect 0 never folds", () => {
        const model = new MapModel(layeredLayout<Node, MapEdge>({ rank: n => n.rank, aspect: 0 }));
        model.update(chain(60));
        settle(model);
        for (let i = 1; i < 60; i++) expect(model.position(`c${i}`)!.y).toBeGreaterThan(model.position(`c${i - 1}`)!.y);
    });

    test("columns are cut where fewest links cross", () => {
        // Two chains of 40, side by side, where each row of each chain also links to the next
        // row of the other, apart from row 20 to 21
        const a = chain(40, "a"), b = chain(40, "b");
        const edges = [...a.edges, ...b.edges];
        for (let i = 0; i < 39; i++) {
            if (i == 20) continue;
            edges.push(edge(`a${i}`, `b${i + 1}`), edge(`b${i}`, `a${i + 1}`));
        }
        const model = new MapModel(layout());
        model.update({ nodes: [...a.nodes, ...b.nodes], edges });
        settle(model);
        const y = (id: string) => model.position(id)!.y;
        const tops = [...Array(40).keys()].filter(i => i > 0 && y(`a${i}`) < y(`a${i - 1}`));
        expect(tops).toContain(21);
    });

    test("adding a row keeps the columns as they were, and puts it in the column of the row above", () => {
        const model = new MapModel(layout());
        const before = chain(60);
        model.update(before);
        settle(model);
        const was = positions(model);
        const after = chain(61);
        model.update(after);
        settle(model);
        const now = positions(model);
        for (let i = 0; i < 59; i++) expect(now[`c${i}`]).toEqual(was[`c${i}`]);
        expect(Math.abs(now.c60[0] - now.c59[0])).toBeLessThan(200);
        expect(now.c60[1]).toBeGreaterThan(now.c59[1]);
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

    test("taking a node's pin away lays it out again, and moving a pin moves it", () => {
        const model = new MapModel(layout());
        model.update(story);
        settle(model);
        const laidOut = positions(model);
        model.update(story, new Map([["l1", { x: 900, y: 900 }]]));
        settle(model);
        expect(positions(model).l1).toEqual([900, 900]);
        model.update(story, new Map([["l1", { x: 950, y: 900 }]]));
        expect(positions(model).l1).toEqual([950, 900]);
        model.update(story, new Map());
        settle(model);
        // Back near its place under left, not left out at 950, 900
        expect(Math.abs(positions(model).l1[1] - laidOut.l1[1])).toBeLessThan(40);
        expect(Math.abs(positions(model).l1[0] - positions(model).left[0])).toBeLessThan(250);
        expect(model.isPinned("l1")).toBe(false);
    });

    test("taking away the pin a drag gave a node puts it back where it was, with what followed it", () => {
        const model = new MapModel(layout());
        model.update(story);
        settle(model);
        const before = positions(model);
        model.startDrag("left");
        for (let i = 0; i < 30; i++) {
            model.drag("left", { x: -400, y: 300 });
            model.step(1000, 1);
        }
        const dropped = model.endDrag();
        // The host pins it there, as saving its position does
        model.update(story, dropped);
        settle(model);
        expect(positions(model).left).toEqual([-400, 300]);
        expect(positions(model).l1).not.toEqual(before.l1);
        // Then undoes the drag
        model.update(story, new Map());
        settle(model);
        expect(positions(model)).toEqual(before);
        expect(model.isPinned("left")).toBe(false);
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
