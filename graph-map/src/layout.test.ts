import { describe, expect, test } from "vitest";
import { countCrossings, layeredLayout } from "./layout.js";
import { seededRandom } from "./random.js";
import type { MapEdge, MapNode } from "./types.js";

interface Node extends MapNode {
    rank: number;
}

// A random graph in rows, each node linked from one or two nodes in the row above, and some
// links skipping rows
function randomGraph(seed: number) {
    const random = seededRandom(seed);
    const nodes: Node[] = [];
    const edges: MapEdge[] = [];
    const rows: Node[][] = [];
    for (let rank = 0; rank < 8; rank++) {
        const row: Node[] = [];
        const count = rank == 0 ? 1 : 2 + Math.floor(random() * 5);
        for (let i = 0; i < count; i++) {
            const node = { id: `${rank}.${i}`, label: "", width: 80, height: 30, rank };
            row.push(node);
            nodes.push(node);
            if (rank == 0) continue;
            const link = (from: Node) => edges.push({ id: `${from.id}->${node.id}`, from: from.id, to: node.id });
            const above = rows[rank - 1];
            link(above[Math.floor(random() * above.length)]);
            if (random() < 0.5) link(above[Math.floor(random() * above.length)]);
            if (rank > 1 && random() < 0.3) link(rows[rank - 2][Math.floor(random() * rows[rank - 2].length)]);
        }
        rows.push(row);
    }
    return { nodes, edges };
}

const crossings = (sweeps: number, graph: ReturnType<typeof randomGraph>) => {
    const placed = layeredLayout<Node, MapEdge>({ rank: n => n.rank, aspect: 0, sweeps }).place(graph, new Map());
    return countCrossings(graph.edges.map(e => [e.from, e.to]), placed);
};

describe("row ordering", () => {
    test("counts crossing lines", () => {
        const at = new Map(Object.entries({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, c: { x: 0, y: 10 }, d: { x: 10, y: 10 } }));
        expect(countCrossings([["a", "d"], ["b", "c"]], at)).toBe(1);
        expect(countCrossings([["a", "c"], ["b", "d"]], at)).toBe(0);
        // Lines that only meet at a node don't cross
        expect(countCrossings([["a", "d"], ["a", "c"]], at)).toBe(0);
    });

    test("sweeping up and down the rows never adds crossings, and usually removes some", () => {
        let without = 0, withSweeps = 0;
        for (let seed = 1; seed <= 20; seed++) {
            const graph = randomGraph(seed);
            const before = crossings(0, graph), after = crossings(8, graph);
            expect(after).toBeLessThanOrEqual(before);
            without += before;
            withSweeps += after;
        }
        expect(withSweeps).toBeLessThan(without * 0.9);
    });
});
