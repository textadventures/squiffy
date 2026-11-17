// Layouts: where new nodes start, and the forces that shape the map from there. The map takes any
// Layout; layeredLayout() is a directed force layout, where each node is pulled towards a row
// (its rank, e.g. its distance from the start), so the map reads from top to bottom while staying
// springy, and "satellite" nodes are held close under the node they belong to.

import { collide, manyBody, springs, towards, type LinkSpring } from "./forces.js";
import type { Force, SimNode } from "./simulation.js";
import type { MapEdge, MapGraph, MapNode, Point } from "./types.js";

export interface Layout<N extends MapNode = MapNode, E extends MapEdge = MapEdge> {
    // Where each node without a known position starts. Must be deterministic, so the same graph
    // gives the same map everywhere.
    place(graph: MapGraph<N, E>, known: ReadonlyMap<string, Point>): Map<string, Point>;
    // The forces that act on the nodes. Rebuilt whenever the graph changes.
    forces(graph: MapGraph<N, E>, nodes: ReadonlyMap<string, SimNode>): Force[];
}

export interface LayeredLayoutOptions<N extends MapNode, E extends MapEdge> {
    // The row a node belongs in, from 0 at the top. Undefined leaves it free to go anywhere.
    rank: (node: N) => number | undefined;
    // The node a satellite belongs to: it's placed and held just below it
    parent?: (node: N) => string | undefined;
    // Separate parts of the graph, e.g. what can't be reached from the start: each group's
    // nodes start in their own area, to the right of the group before
    group?: (node: N) => number;
    // How strongly an edge pulls its ends together, from 0 to 1 (default 0.5)
    edgeStrength?: (edge: E) => number;
    // The distance between rows
    rowGap?: number;
    // The space between nodes in a row, as they're first placed
    columnGap?: number;
}

export function layeredLayout<N extends MapNode, E extends MapEdge>(options: LayeredLayoutOptions<N, E>): Layout<N, E> {
    const rowGap = options.rowGap ?? 100;
    const columnGap = options.columnGap ?? 32;
    const parentOf = (node: N) => options.parent?.(node);
    const groupOf = (node: N) => options.group?.(node) ?? 0;
    const satelliteGap = 18;

    // Where a satellite sits under its parent, given its place among its siblings
    function underParent(parent: { x: number; y: number; height: number }, satellites: N[], index: number, node: N): Point {
        const widths = satellites.map(s => s.width);
        const total = widths.reduce((a, b) => a + b, 0) + columnGap / 2 * (satellites.length - 1);
        let x = parent.x - total / 2;
        for (let i = 0; i < index; i++) x += widths[i] + columnGap / 2;
        return { x: x + node.width / 2, y: parent.y + parent.height / 2 + satelliteGap + node.height / 2 };
    }

    return {
        place(graph, known) {
            const placed = new Map<string, Point>();
            const byId = new Map(graph.nodes.map(n => [n.id, n]));
            const satellitesOf = new Map<string, N[]>();
            const main: N[] = [];
            for (const node of graph.nodes) {
                const parent = parentOf(node);
                if (parent !== undefined && byId.has(parent)) {
                    let list = satellitesOf.get(parent);
                    if (!list) satellitesOf.set(parent, list = []);
                    list.push(node);
                } else {
                    main.push(node);
                }
            }
            const position = (id: string) => known.get(id) ?? placed.get(id);
            const rowY = (node: N) => (options.rank(node) ?? 0) * rowGap;

            const fresh = main.filter(n => !known.has(n.id));
            if (known.size == 0) {
                // Everything's new: lay out each group's rows, side by side
                const groups = new Map<number, N[]>();
                for (const node of fresh) {
                    const g = groupOf(node);
                    let list = groups.get(g);
                    if (!list) groups.set(g, list = []);
                    list.push(node);
                }
                let left = 0;
                for (const g of [...groups.keys()].sort((a, b) => a - b)) {
                    const width = placeRows(groups.get(g)!, graph.edges, left);
                    left += width + columnGap * 4;
                }
            } else {
                // Add new nodes next to something they're linked to, or at the end of their row
                const neighbours = new Map<string, string[]>();
                const link = (a: string, b: string) => {
                    let list = neighbours.get(a);
                    if (!list) neighbours.set(a, list = []);
                    list.push(b);
                };
                for (const edge of graph.edges) {
                    link(edge.to, edge.from);
                    link(edge.from, edge.to);
                }
                let rightmost = -Infinity;
                for (const p of known.values()) rightmost = Math.max(rightmost, p.x);
                for (const node of fresh) {
                    const y = options.rank(node) === undefined ? undefined : rowY(node);
                    const anchorId = (neighbours.get(node.id) ?? []).find(id => position(id) && byId.has(id));
                    if (anchorId) {
                        const anchor = position(anchorId)!;
                        const anchorNode = byId.get(anchorId)!;
                        placed.set(node.id, {
                            x: anchor.x + (anchorNode.width + node.width) / 2 + columnGap,
                            y: y ?? anchor.y + rowGap,
                        });
                    } else {
                        rightmost = (rightmost == -Infinity ? 0 : rightmost + columnGap) + node.width;
                        placed.set(node.id, { x: rightmost, y: y ?? 0 });
                    }
                }
            }

            // Satellites under their parents
            for (const [parentId, satellites] of satellitesOf) {
                const parent = byId.get(parentId)!;
                const at = position(parentId);
                if (!at) continue;
                satellites.forEach((node, i) => {
                    if (!known.has(node.id)) placed.set(node.id, underParent({ ...at, height: parent.height }, satellites, i, node));
                });
            }
            return placed;

            // Rows from the top, each ordered by where the nodes linking to it are (the
            // barycentre heuristic), to cut down crossings. Returns the widest row's width.
            function placeRows(nodes: N[], edges: E[], left: number): number {
                const rows = new Map<number, N[]>();
                const unranked: N[] = [];
                for (const node of nodes) {
                    const rank = options.rank(node);
                    if (rank === undefined) {
                        unranked.push(node);
                        continue;
                    }
                    let row = rows.get(rank);
                    if (!row) rows.set(rank, row = []);
                    row.push(node);
                }
                const ranks = [...rows.keys()].sort((a, b) => a - b);
                // Nodes without a rank go in a row of their own at the bottom
                if (unranked.length) {
                    const rank = ranks.length ? ranks[ranks.length - 1] + 1 : 0;
                    rows.set(rank, unranked);
                    ranks.push(rank);
                }

                const satelliteRoot = new Map<string, string>();
                for (const [parentId, satellites] of satellitesOf) {
                    for (const s of satellites) satelliteRoot.set(s.id, parentId);
                }
                const incoming = new Map<string, string[]>();
                for (const edge of edges) {
                    const from = satelliteRoot.get(edge.from) ?? edge.from;
                    const to = satelliteRoot.get(edge.to) ?? edge.to;
                    if (from == to) continue;
                    let list = incoming.get(to);
                    if (!list) incoming.set(to, list = []);
                    list.push(from);
                }

                // A row's width includes the satellites hanging under its nodes
                const span = (node: N) => {
                    const satellites = satellitesOf.get(node.id) ?? [];
                    const under = satellites.reduce((a, s) => a + s.width, 0) + columnGap / 2 * Math.max(0, satellites.length - 1);
                    return Math.max(node.width, under);
                };
                const rowWidth = (row: N[]) => row.reduce((a, n) => a + span(n), 0) + columnGap * (row.length - 1);
                const widest = Math.max(...[...rows.values()].map(rowWidth));
                const centre = left + widest / 2;
                for (const rank of ranks) {
                    const row = rows.get(rank)!;
                    const order = new Map(row.map((n, i) => [n.id, i]));
                    const barycentre = (node: N) => {
                        const xs = (incoming.get(node.id) ?? []).map(id => placed.get(id)?.x).filter(x => x !== undefined);
                        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
                    };
                    const keyed = row.map(n => ({ n, key: barycentre(n) }));
                    // Nodes with nothing above them keep their place in the order they're given
                    keyed.sort((a, b) => (a.key ?? Infinity) - (b.key ?? Infinity) || order.get(a.n.id)! - order.get(b.n.id)!);
                    let x = centre - rowWidth(row) / 2;
                    for (const { n } of keyed) {
                        const w = span(n);
                        placed.set(n.id, { x: x + w / 2, y: rank * rowGap });
                        x += w + columnGap;
                    }
                }
                return widest;
            }
        },

        forces(graph, nodes) {
            const byId = new Map(graph.nodes.map(n => [n.id, n]));
            const sim = (id: string) => nodes.get(id);
            const parentSim = new Map<SimNode, SimNode>();
            const rankY = new Map<SimNode, number>();
            for (const node of graph.nodes) {
                const s = sim(node.id);
                if (!s) continue;
                const parent = parentOf(node);
                const p = parent === undefined ? undefined : sim(parent);
                if (p) parentSim.set(s, p);
                else {
                    const rank = options.rank(node);
                    if (rank !== undefined) rankY.set(s, rank * rowGap);
                }
            }

            const links: LinkSpring[] = [];
            const degree = new Map<string, number>();
            for (const edge of graph.edges) {
                degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
                degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
            }
            for (const edge of graph.edges) {
                const source = sim(edge.from), target = sim(edge.to);
                if (!source || !target || source === target) continue;
                // A satellite's own links are its parent's business: just a weak pull
                const satellite = parentSim.has(source) || parentSim.has(target);
                if (parentSim.get(target) === source || parentSim.get(source) === target) continue;
                const from = byId.get(edge.from)!, to = byId.get(edge.to)!;
                const span = Math.abs((options.rank(to) ?? 0) - (options.rank(from) ?? 0));
                const strength = (options.edgeStrength?.(edge) ?? 0.5)
                    / Math.min(degree.get(edge.from)!, degree.get(edge.to)!)
                    / (1 + Math.max(0, span - 1))
                    * (satellite ? 0.2 : 1);
                links.push({ source, target, distance: rowGap * Math.max(1, Math.min(span, 3)), strength });
            }
            for (const [satellite, parent] of parentSim) {
                links.push({ source: parent, target: satellite, distance: (parent.height + satellite.height) / 2 + satelliteGap, strength: 0.6 });
            }

            return [
                manyBody({ strength: n => parentSim.has(n) ? -40 : -250, distanceMax: rowGap * 5 }),
                springs(links),
                // Rows
                towards("y", n => {
                    const parent = parentSim.get(n);
                    return parent ? parent.y + (parent.height + n.height) / 2 + satelliteGap : rankY.get(n);
                }, 0.4),
                // Satellites stay under their parents; everything else near where it started
                towards("x", n => parentSim.get(n)?.x ?? n.home?.x, n => parentSim.has(n) ? 0.05 : 0.02),
                collide({ padding: 8 }),
            ];
        },
    };
}
