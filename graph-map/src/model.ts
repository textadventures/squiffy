// The map's live state, apart from drawing it: each node's position, the simulation, and what's
// held still. Keeps the map stable as the graph changes:
//
// - Nodes the host has pinned (e.g. hand-placed by the author) never move, unless dragged.
// - When nodes are added, the ones already there are held still while the new ones settle, apart
//   from their neighbours, which can make room. Once it settles, nothing is held.
// - Dragging a node lets every unpinned node move, so its neighbours follow, and the dropped node
//   is pinned where it's dropped.

import type { Layout } from "./layout.js";
import { Simulation, type SimNode } from "./simulation.js";
import type { MapEdge, MapGraph, MapNode, Point } from "./types.js";

export class MapModel<N extends MapNode = MapNode, E extends MapEdge = MapEdge> {
    readonly sim: Simulation;
    readonly nodes = new Map<string, SimNode>();
    private graph: MapGraph<N, E> = { nodes: [], edges: [] };
    private pinned = new Map<string, Point>();
    // Held still while new nodes settle
    private held = new Set<string>();
    private dragging: string | undefined;

    constructor(private layout: Layout<N, E>, seed = 1) {
        this.sim = new Simulation({ seed });
    }

    get settled() {
        return this.sim.settled;
    }

    position(id: string): Point | undefined {
        return this.nodes.get(id);
    }

    // Shows a new version of the graph. `pinned` is where the host has pinned nodes.
    update(graph: MapGraph<N, E>, pinned: ReadonlyMap<string, Point> = new Map()) {
        const first = this.nodes.size == 0;
        this.graph = graph;
        this.pinned = new Map(pinned);
        const ids = new Set(graph.nodes.map(n => n.id));
        for (const id of [...this.nodes.keys()]) {
            if (!ids.has(id)) this.nodes.delete(id);
        }
        for (const id of [...this.held]) {
            if (!ids.has(id)) this.held.delete(id);
        }

        const known = new Map<string, Point>();
        for (const [id, node] of this.nodes) known.set(id, { x: node.x, y: node.y });
        for (const [id, p] of this.pinned) {
            if (ids.has(id)) known.set(id, p);
        }
        const placed = this.layout.place(graph, known);
        const added: string[] = [];
        for (const node of graph.nodes) {
            let sim = this.nodes.get(node.id);
            if (!sim) {
                const at = known.get(node.id) ?? placed.get(node.id) ?? { x: 0, y: 0 };
                sim = { id: node.id, x: at.x, y: at.y, vx: 0, vy: 0, width: node.width, height: node.height, fixed: false, home: { ...at } };
                this.nodes.set(node.id, sim);
                if (!this.pinned.has(node.id)) added.push(node.id);
            }
            sim.width = node.width;
            sim.height = node.height;
            const pin = this.pinned.get(node.id);
            if (pin && node.id != this.dragging) {
                sim.x = pin.x;
                sim.y = pin.y;
                sim.home = { ...pin };
            }
        }
        // In the graph's order, so the simulation is the same everywhere
        this.sim.nodes = graph.nodes.map(n => this.nodes.get(n.id)!);
        this.sim.forces = this.layout.forces(graph, this.nodes);

        if (first) {
            this.sim.alpha = 1;
        } else if (added.length) {
            // Hold everything else still, apart from what the new nodes are linked to
            const free = new Set(added);
            for (const edge of graph.edges) {
                if (free.has(edge.from) || free.has(edge.to)) {
                    free.add(edge.from);
                    free.add(edge.to);
                }
            }
            for (const id of this.nodes.keys()) {
                if (!free.has(id)) this.held.add(id);
            }
            this.sim.reheat(0.5);
        }
        this.updateFixed();
    }

    // Forgets every position but the pinned ones, and lays the graph out again
    relayout(pinned: ReadonlyMap<string, Point> = this.pinned) {
        this.nodes.clear();
        this.held.clear();
        this.sim.alpha = 1;
        this.update(this.graph, pinned);
    }

    // A node now has another id, e.g. after a rename, and keeps its position
    rename(from: string, to: string) {
        const node = this.nodes.get(from);
        if (!node || this.nodes.has(to)) return;
        this.nodes.delete(from);
        node.id = to;
        this.nodes.set(to, node);
        if (this.held.delete(from)) this.held.add(to);
        const pin = this.pinned.get(from);
        if (pin) {
            this.pinned.delete(from);
            this.pinned.set(to, pin);
        }
    }

    startDrag(id: string) {
        if (!this.nodes.has(id)) return;
        this.dragging = id;
        this.held.clear();
        this.updateFixed();
        this.sim.alphaTarget = 0.3;
        this.sim.reheat(0.3);
    }

    drag(id: string, at: Point) {
        const node = this.nodes.get(id);
        if (!node) return;
        node.x = at.x;
        node.y = at.y;
    }

    // Drops a dragged node, pinning it where it is, and returns where that is
    endDrag(id: string): Point | undefined {
        const node = this.nodes.get(id);
        this.dragging = undefined;
        this.sim.alphaTarget = 0;
        if (!node) return undefined;
        const at = { x: Math.round(node.x), y: Math.round(node.y) };
        node.x = at.x;
        node.y = at.y;
        node.home = { ...at };
        this.pinned.set(id, at);
        this.updateFixed();
        return at;
    }

    isPinned(id: string) {
        return this.pinned.has(id);
    }

    // Runs the simulation for up to `budgetMs`, and says whether anything moved
    step(budgetMs: number, maxTicks = Infinity): boolean {
        if (this.sim.settled) return false;
        this.sim.run(budgetMs, maxTicks);
        if (this.sim.settled && this.held.size) {
            this.held.clear();
            this.updateFixed();
        }
        return true;
    }

    private updateFixed() {
        for (const [id, node] of this.nodes) {
            node.fixed = id == this.dragging || this.pinned.has(id) || this.held.has(id);
        }
    }
}
