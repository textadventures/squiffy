// Layouts: where new nodes start, and the forces that shape the map from there. The map takes any
// Layout; layeredLayout() is a directed force layout, where each node is pulled towards a row
// (its rank, e.g. how far it is from the start), so the map reads from top to bottom while staying
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
    // Nodes that go wherever another goes, by the id of the one they follow, such as satellites
    // under their parent: when that one moves, so do they
    attached?(graph: MapGraph<N, E>): Map<string, string[]>;
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

    // Satellites per line under their parent: more go on further lines
    const perLine = 3;
    const satelliteSpacing = columnGap / 2;

    // How the graph's laid out, apart from where things are: which satellites belong to which
    // node and where they sit under it, and how far down each row is. A row is as tall as the
    // satellites hanging under its nodes need.
    function arrange(graph: MapGraph<N, E>) {
        const byId = new Map(graph.nodes.map(n => [n.id, n]));
        const satellitesOf = new Map<string, N[]>();
        const main: N[] = [];
        for (const node of graph.nodes) {
            const parent = parentOf(node);
            if (parent !== undefined && byId.has(parent) && parentOf(byId.get(parent)!) === undefined) {
                let list = satellitesOf.get(parent);
                if (!list) satellitesOf.set(parent, list = []);
                list.push(node);
            } else {
                main.push(node);
            }
        }
        // Each satellite's offset from its parent's centre, and the size of the block they make
        const offset = new Map<string, Point>();
        const block = new Map<string, { width: number; height: number }>();
        for (const [parentId, satellites] of satellitesOf) {
            const parent = byId.get(parentId)!;
            const lineHeight = Math.max(...satellites.map(s => s.height)) + 8;
            let width = 0;
            for (let start = 0; start < satellites.length; start += perLine) {
                const line = satellites.slice(start, start + perLine);
                const lineWidth = line.reduce((a, s) => a + s.width, 0) + satelliteSpacing * (line.length - 1);
                width = Math.max(width, lineWidth);
                let x = -lineWidth / 2;
                for (const s of line) {
                    offset.set(s.id, { x: x + s.width / 2, y: parent.height / 2 + satelliteGap + (start / perLine) * lineHeight + s.height / 2 });
                    x += s.width + satelliteSpacing;
                }
            }
            block.set(parentId, { width, height: satelliteGap + Math.ceil(satellites.length / perLine) * lineHeight });
        }
        // Rows: each one's top is below the one before, and whatever hangs under it
        const below = new Map<number, number>();
        for (const node of main) {
            const rank = options.rank(node);
            if (rank === undefined) continue;
            below.set(rank, Math.max(below.get(rank) ?? 0, block.get(node.id)?.height ?? 0));
        }
        const ranks = [...below.keys()].sort((a, b) => a - b);
        const rowYs = new Map<number, number>();
        let y = 0;
        ranks.forEach((rank, i) => {
            if (i > 0) y += (rank - ranks[i - 1]) * rowGap + below.get(ranks[i - 1])!;
            rowYs.set(rank, y);
        });
        const last = ranks.length ? ranks[ranks.length - 1] : 0;
        const rowY = (rank: number) => rowYs.get(rank) ?? (rowYs.get(last) ?? 0) + (rank - last) * rowGap + (below.get(last) ?? 0);
        return { byId, satellitesOf, main, offset, block, rowY };
    }

    return {
        place(graph, known) {
            const placed = new Map<string, Point>();
            const { byId, satellitesOf, main, offset, block, rowY } = arrange(graph);
            const position = (id: string) => known.get(id) ?? placed.get(id);

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
                    const rank = options.rank(node);
                    const y = rank === undefined ? undefined : rowY(rank);
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
                const at = position(parentId);
                if (!at) continue;
                for (const node of satellites) {
                    const o = offset.get(node.id)!;
                    if (!known.has(node.id)) placed.set(node.id, { x: at.x + o.x, y: at.y + o.y });
                }
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
                const span = (node: N) => Math.max(node.width, block.get(node.id)?.width ?? 0);
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
                        placed.set(n.id, { x: x + w / 2, y: rowY(rank) });
                        x += w + columnGap;
                    }
                }
                return widest;
            }
        },

        attached(graph) {
            return new Map([...arrange(graph).satellitesOf].map(([id, satellites]) => [id, satellites.map(s => s.id)]));
        },

        forces(graph, nodes) {
            const { byId, offset, rowY } = arrange(graph);
            const sim = (id: string) => nodes.get(id);
            const parentSim = new Map<SimNode, SimNode>();
            const satelliteOffset = new Map<SimNode, Point>();
            const rankY = new Map<SimNode, number>();
            for (const node of graph.nodes) {
                const s = sim(node.id);
                if (!s) continue;
                const o = offset.get(node.id);
                const p = o && sim(parentOf(node)!);
                if (o && p) {
                    parentSim.set(s, p);
                    satelliteOffset.set(s, o);
                } else {
                    const rank = options.rank(node);
                    if (rank !== undefined) rankY.set(s, rowY(rank));
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
                const o = satelliteOffset.get(satellite)!;
                links.push({ source: parent, target: satellite, distance: Math.hypot(o.x, o.y), strength: 0.6 });
            }

            return [
                manyBody({ strength: n => parentSim.has(n) ? -40 : -250, distanceMax: rowGap * 5 }),
                springs(links),
                // Rows
                towards("y", n => {
                    const parent = parentSim.get(n);
                    return parent ? parent.y + satelliteOffset.get(n)!.y : rankY.get(n);
                }, n => parentSim.has(n) ? 0.4 : 0.8),
                // Satellites stay in their places under their parents; everything else near where
                // it started
                towards("x", n => {
                    const parent = parentSim.get(n);
                    return parent ? parent.x + satelliteOffset.get(n)!.x : n.home?.x;
                }, n => parentSim.has(n) ? 0.3 : 0.02),
                // Two nodes in rows move apart along the row, rather than out of it
                collide({ padding: 8, sideways: n => rankY.has(n) }),
            ];
        },
    };
}
