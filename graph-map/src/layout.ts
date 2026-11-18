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
    // The shape the map should roughly have, as its width over its height (default 1.6, a
    // screen's). When there are so many rows that the map would be much taller than that, they
    // fold into columns side by side, like a newspaper's, so the whole map fits the screen
    // better. 0 never folds.
    aspect?: number;
    // When the graph's laid out afresh, how many times to sweep up and down the rows reordering
    // each by where its neighbours are, keeping the order where fewest edges cross (default 0)
    sweeps?: number;
}

// A row of the map: the nodes of one rank in one group
interface Row<N> {
    group: number;
    rank: number;
    nodes: N[];
    // Its width as first placed, and the height of what hangs under it
    width: number;
    below: number;
}

export function layeredLayout<N extends MapNode, E extends MapEdge>(options: LayeredLayoutOptions<N, E>): Layout<N, E> {
    const rowGap = options.rowGap ?? 100;
    const columnGap = options.columnGap ?? 32;
    const aspect = options.aspect ?? 1.6;
    const sweeps = options.sweeps ?? 0;
    const parentOf = (node: N) => options.parent?.(node);
    const groupOf = (node: N) => options.group?.(node) ?? 0;
    const satelliteGap = 18;
    // The space between columns of folded rows, and between groups
    const foldGap = columnGap * 5;

    // Satellites per line under their parent: more go on further lines
    const perLine = 3;
    const satelliteSpacing = columnGap / 2;

    // Which column each row is in, by group and rank. It's worked out when the whole graph is laid
    // out afresh, and kept as the graph changes, so that adding to it doesn't move rows from one
    // column to another: a new row goes in the column of the row above it.
    const folds = new Map<string, number>();
    const rowKey = (group: number, rank: number) => `${group}:${rank}`;

    // How the graph's laid out, apart from where things are: which satellites belong to which
    // node and where they sit under it, which row each node is in, and where each row is. A row
    // is as tall as the satellites hanging under its nodes need. `refold` works out the columns
    // afresh.
    function arrange(graph: MapGraph<N, E>, refold = false) {
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
        const satelliteRoot = new Map<string, string>();
        for (const [parentId, satellites] of satellitesOf) {
            for (const s of satellites) satelliteRoot.set(s.id, parentId);
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
        // A node's width includes the satellites hanging under it
        const span = (node: N) => Math.max(node.width, block.get(node.id)?.width ?? 0);

        // Rows, by group. Nodes without a rank go in a row of their own at the bottom of their
        // group, though nothing holds them there.
        const groupRows = new Map<number, Row<N>[]>();
        const rowOf = new Map<string, Row<N>>();
        {
            const ranked = new Map<number, Map<number, N[]>>();
            const unranked = new Map<number, N[]>();
            for (const node of main) {
                const g = groupOf(node);
                const rank = options.rank(node);
                if (rank === undefined) {
                    (unranked.get(g) ?? unranked.set(g, []).get(g)!).push(node);
                    continue;
                }
                const rows = ranked.get(g) ?? ranked.set(g, new Map()).get(g)!;
                (rows.get(rank) ?? rows.set(rank, []).get(rank)!).push(node);
            }
            for (const g of [...new Set([...ranked.keys(), ...unranked.keys()])].sort((a, b) => a - b)) {
                const byRank = ranked.get(g) ?? new Map<number, N[]>();
                const ranks = [...byRank.keys()].sort((a, b) => a - b);
                const lists = ranks.map(rank => ({ rank, nodes: byRank.get(rank)! }));
                if (unranked.has(g)) lists.push({ rank: ranks.length ? ranks[ranks.length - 1] + 1 : 0, nodes: unranked.get(g)! });
                const rows = lists.map(({ rank, nodes }) => ({
                    group: g,
                    rank,
                    nodes,
                    width: nodes.reduce((a, n) => a + span(n), 0) + columnGap * (nodes.length - 1),
                    below: Math.max(0, ...nodes.map(n => block.get(n.id)?.height ?? 0)),
                }));
                groupRows.set(g, rows);
                for (const row of rows) for (const n of row.nodes) rowOf.set(n.id, row);
            }
        }

        // The columns, and where each row is in its column
        const fresh = [...groupRows].filter(([g, rows]) => refold || !rows.some(r => folds.has(rowKey(g, r.rank))));
        if (fresh.length) {
            // Folded to the height of the columns already there, if there are any
            let height: number | undefined;
            if (fresh.length < groupRows.size) {
                const heights = new Map<string, number>();
                for (const [g, rows] of groupRows) {
                    for (const row of rows) {
                        const c = folds.get(rowKey(g, row.rank));
                        if (c === undefined) continue;
                        const key = rowKey(g, c);
                        heights.set(key, (heights.get(key) ?? 0) + rowGap + row.below);
                    }
                }
                height = Math.max(...heights.values());
            }
            const columns = fold(fresh.map(([, rows]) => rows), graph.edges, satelliteRoot, rowOf, height);
            fresh.forEach(([g, rows], i) => {
                for (const key of [...folds.keys()]) if (key.startsWith(`${g}:`)) folds.delete(key);
                rows.forEach((row, j) => folds.set(rowKey(g, row.rank), columns[i][j]));
            });
        }
        const columnOf = new Map<Row<N>, number>();
        const rowY = new Map<Row<N>, number>();
        const centreOf = new Map<Row<N>, number>();
        let left = 0;
        for (const [g, rows] of groupRows) {
            // A new row goes in the column of the row above it
            let column = 0;
            for (const row of rows) {
                const key = rowKey(g, row.rank);
                column = folds.get(key) ?? column;
                folds.set(key, column);
            }
            const columns = new Map<number, Row<N>[]>();
            for (const row of rows) {
                const c = folds.get(rowKey(g, row.rank))!;
                columnOf.set(row, c);
                (columns.get(c) ?? columns.set(c, []).get(c)!).push(row);
            }
            for (const c of [...columns.keys()].sort((a, b) => a - b)) {
                const column = columns.get(c)!;
                let y = 0;
                column.forEach((row, i) => {
                    if (i > 0) y += (row.rank - column[i - 1].rank) * rowGap + column[i - 1].below;
                    rowY.set(row, y);
                });
                const width = Math.max(...column.map(r => r.width));
                for (const row of column) centreOf.set(row, left + width / 2);
                left += width + foldGap;
            }
        }
        // Columns, numbered across every group
        const columnKey = (row: Row<N>) => rowKey(row.group, columnOf.get(row)!);
        return { byId, satellitesOf, satelliteRoot, main, offset, block, span, groupRows, rowOf, rowY, centreOf, columnKey };
    }

    // Which column each row goes in, for each group, folding them into columns side by side, as
    // many as gives the map the shape closest to `aspect`. Each column is a run of rows, about as
    // tall as the others, and it's cut where fewest edges cross from one column to the next. The
    // tallest group decides how tall the columns are, and the others fold to fit, unless
    // `height` says how tall they are already.
    function fold(groups: Row<N>[][], edges: E[], satelliteRoot: Map<string, string>, rowOf: Map<string, Row<N>>, height?: number): number[][] {
        const prepared = groups.map(rows => {
            const n = rows.length;
            const heights = rows.map(r => rowGap + r.below);
            // How many edges cross between row i and row i + 1
            const index = new Map(rows.map((r, i) => [r, i]));
            const diff = new Array<number>(n + 1).fill(0);
            for (const edge of edges) {
                const a = rowOf.get(satelliteRoot.get(edge.from) ?? edge.from), b = rowOf.get(satelliteRoot.get(edge.to) ?? edge.to);
                if (!a || !b || a === b) continue;
                const i = index.get(a), j = index.get(b);
                if (i === undefined || j === undefined) continue;
                diff[Math.min(i, j)]++;
                diff[Math.max(i, j)]--;
            }
            const crossing: number[] = [];
            let open = 0;
            for (let i = 0; i < n; i++) crossing.push(open += diff[i]);
            return { rows, n, heights, crossing, total: heights.reduce((a, b) => a + b, 0) };
        });
        type Group = (typeof prepared)[number];

        // Cuts a group's rows into k columns, each about as tall as what's left over the columns left
        const cut = ({ n, heights, crossing }: Group, k: number) => {
            const columns: number[] = [];
            let start = 0;
            for (let c = 0; c < k && start < n; c++) {
                if (c == k - 1) {
                    for (let i = start; i < n; i++) columns.push(c);
                    break;
                }
                let remaining = 0;
                for (let i = start; i < n; i++) remaining += heights[i];
                const target = remaining / (k - c);
                // The best place to end this column, near the target height
                let best = -1, bestCost = Infinity, h = 0;
                for (let i = start; i < n - (k - c - 1); i++) {
                    h += heights[i];
                    if (h < target * 0.75) continue;
                    if (h > target * 1.25 && best >= 0) break;
                    const cost = crossing[i] + 4 * Math.abs(h - target) / target;
                    if (cost < bestCost) {
                        best = i;
                        bestCost = cost;
                    }
                }
                if (best < 0) best = Math.min(start, n - 1);
                for (let i = start; i <= best; i++) columns.push(c);
                start = best + 1;
            }
            return columns;
        };
        const measure = (group: Group, columns: number[]) => {
            const widths = new Map<number, number>(), heights = new Map<number, number>();
            columns.forEach((c, i) => {
                widths.set(c, Math.max(widths.get(c) ?? 0, group.rows[i].width));
                heights.set(c, (heights.get(c) ?? 0) + group.heights[i]);
            });
            return { width: [...widths.values()].reduce((a, b) => a + b, 0) + foldGap * (widths.size - 1), height: Math.max(0, ...heights.values()) };
        };
        // The fewest columns that a group fits in, at a height
        const fit = (group: Group, height: number) => {
            for (let k = Math.max(1, Math.floor(group.total / height)); k < group.n; k++) {
                const columns = cut(group, k);
                if (measure(group, columns).height <= height * 1.1) return columns;
            }
            return group.rows.map((_, i) => i);
        };
        const single = prepared.map(g => g.rows.map(() => 0));
        if (!(aspect > 0)) return single;

        // Every group, folded to a height, and the map's shape
        const foldAll = (height: number, first?: { group: Group; columns: number[] }) => {
            const all = prepared.map(g => g === first?.group ? first.columns : fit(g, height));
            let width = 0, tallest = 0;
            all.forEach((columns, i) => {
                const m = measure(prepared[i], columns);
                width += m.width + (i > 0 ? foldGap : 0);
                tallest = Math.max(tallest, m.height);
            });
            return { all, score: Math.abs(Math.log(width / tallest / aspect)), shape: width / tallest };
        };
        if (height !== undefined) return foldAll(height).all;
        const tallest = prepared.reduce((a, b) => b.total > a.total ? b : a, prepared[0]);
        let best = single, bestScore = Infinity;
        for (let k = 1; k <= tallest.n; k++) {
            const columns = cut(tallest, k);
            const { all, score, shape } = foldAll(measure(tallest, columns).height, { group: tallest, columns });
            if (score < bestScore) {
                best = all;
                bestScore = score;
            }
            if (shape > aspect) break;
        }
        return best;
    }

    return {
        place(graph, known) {
            const placed = new Map<string, Point>();
            const { byId, satellitesOf, satelliteRoot, offset, span, groupRows, rowOf, rowY, centreOf, columnKey } = arrange(graph, known.size == 0);
            const position = (id: string) => known.get(id) ?? placed.get(id);

            if (known.size == 0) {
                // Everything's new: lay out each group's rows, in their columns. Each row is
                // ordered by where the nodes linking to it are (the barycentre heuristic), to cut
                // down crossings: as an offset from their column's centre, so a row at the top of
                // a column follows the order of the row at the bottom of the column before.
                const neighbours = new Map<string, string[]>();
                for (const edge of graph.edges) {
                    const from = satelliteRoot.get(edge.from) ?? edge.from;
                    const to = satelliteRoot.get(edge.to) ?? edge.to;
                    if (from == to) continue;
                    (neighbours.get(to) ?? neighbours.set(to, []).get(to)!).push(from);
                    (neighbours.get(from) ?? neighbours.set(from, []).get(from)!).push(to);
                }
                const rowIndex = new Map<Row<N>, number>();
                for (const rows of groupRows.values()) rows.forEach((r, i) => rowIndex.set(r, i));
                // Orders a row by where its nodes' neighbours are in the rows above it (or below,
                // going up), and places it. Nodes with no neighbours there keep their place.
                const placeRow = (row: Row<N>, down: boolean) => {
                    const here = rowIndex.get(row)!;
                    const centre = centreOf.get(row)!;
                    const before = new Map(row.nodes.map((n, i) => [n.id, i]));
                    const barycentre = (node: N) => {
                        let sum = 0, count = 0;
                        for (const id of neighbours.get(node.id) ?? []) {
                            const p = placed.get(id), from = rowOf.get(id);
                            if (!p || !from || from.group != row.group) continue;
                            const i = rowIndex.get(from)!;
                            if (down ? i < here : i > here) {
                                sum += p.x - centreOf.get(from)!;
                                count++;
                            }
                        }
                        return count ? sum / count : undefined;
                    };
                    const keyed = row.nodes.map(n => {
                        const p = placed.get(n.id);
                        return { n, key: barycentre(n) ?? (p ? p.x - centre : undefined) };
                    });
                    keyed.sort((a, b) => (a.key ?? Infinity) - (b.key ?? Infinity) || before.get(a.n.id)! - before.get(b.n.id)!);
                    row.nodes = keyed.map(k => k.n);
                    let x = centre - row.width / 2;
                    for (const n of row.nodes) {
                        const w = span(n);
                        placed.set(n.id, { x: x + w / 2, y: rowY.get(row)! });
                        x += w + columnGap;
                    }
                };
                const allRows = [...groupRows.values()];
                for (const rows of allRows) for (const row of rows) placeRow(row, true);
                // Then sweeps up and down the rows, keeping the order with the fewest crossings.
                // Counting them is slow on big, tangled maps, so it stops once a sweep up and a
                // sweep down in a row bring no improvement.
                if (sweeps > 0) {
                    const ends = graph.edges
                        .map(e => [satelliteRoot.get(e.from) ?? e.from, satelliteRoot.get(e.to) ?? e.to])
                        .filter(([a, b]) => a != b);
                    let best = new Map(placed), bestCount = countCrossings(ends, placed);
                    let stale = 0;
                    for (let s = 0; s < sweeps && bestCount > 0 && stale < 2; s++) {
                        const down = s % 2 == 1;
                        for (const rows of allRows) for (const row of down ? rows : [...rows].reverse()) placeRow(row, down);
                        const count = countCrossings(ends, placed);
                        if (count < bestCount) {
                            best = new Map(placed);
                            bestCount = count;
                            stale = 0;
                        } else {
                            stale++;
                        }
                    }
                    for (const [k, v] of best) placed.set(k, v);
                }
            } else {
                // Add new nodes next to something they're linked to, in their own column if
                // there is one, or at the end of their row
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
                for (const node of graph.nodes) {
                    if (known.has(node.id) || satelliteRoot.has(node.id)) continue;
                    const row = rowOf.get(node.id)!;
                    const y = options.rank(node) !== undefined ? rowY.get(row) : undefined;
                    const linked = (neighbours.get(node.id) ?? []).filter(id => position(id) && byId.has(id));
                    const sameColumn = (id: string) => {
                        const other = rowOf.get(satelliteRoot.get(id) ?? id);
                        return !!other && columnKey(other) == columnKey(row);
                    };
                    const anchorId = linked.find(sameColumn) ?? linked[0];
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
        },

        attached(graph) {
            return new Map([...arrange(graph).satellitesOf].map(([id, satellites]) => [id, satellites.map(s => s.id)]));
        },

        forces(graph, nodes) {
            const { byId, offset, rowOf, rowY, satelliteRoot, columnKey } = arrange(graph);
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
                } else if (options.rank(node) !== undefined) {
                    rankY.set(s, rowY.get(rowOf.get(node.id)!)!);
                }
            }
            const column = (id: string) => {
                const row = rowOf.get(satelliteRoot.get(id) ?? id);
                return row && columnKey(row);
            };

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
                // Folded columns stay apart: an edge from one to another hardly pulls
                const across = column(edge.from) != column(edge.to);
                const strength = (options.edgeStrength?.(edge) ?? 0.5)
                    / Math.min(degree.get(edge.from)!, degree.get(edge.to)!)
                    / (1 + Math.max(0, span - 1))
                    * (satellite ? 0.2 : 1)
                    * (across ? 0.02 : 1);
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

// How many pairs of straight lines between nodes cross, e.g. to compare orderings of rows
export function countCrossings(ends: string[][], at: ReadonlyMap<string, Point>): number {
    const segs: number[][] = [];
    for (const [a, b] of ends) {
        const p = at.get(a), q = at.get(b);
        if (p && q) segs.push([Math.min(p.x, q.x), Math.max(p.x, q.x), Math.min(p.y, q.y), Math.max(p.y, q.y), p.x, p.y, q.x, q.y]);
    }
    // Sorted by top, so only lines that overlap vertically are compared
    segs.sort((s, t) => s[2] - t[2]);
    let count = 0;
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        for (let j = i + 1; j < segs.length && segs[j][2] < s[3]; j++) {
            const t = segs[j];
            if (t[0] > s[1] || t[1] < s[0]) continue;
            const [, , , , x1, y1, x2, y2] = s, [, , , , x3, y3, x4, y4] = t;
            const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
            if (d == 0) continue;
            const u = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d, v = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
            if (u > 0.001 && u < 0.999 && v > 0.001 && v < 0.999) count++;
        }
    }
    return count;
}
