// The map's live state, apart from drawing it: each node's position, the simulation, and what's
// held still. Keeps the map stable as the graph changes:
//
// - Nodes the host has pinned (e.g. hand-placed by the author) never move, unless dragged.
// - When nodes are added, the ones already there are held still while the new ones settle, apart
//   from their neighbours, which can make room. Once it settles, nothing is held.
// - Dragging a node (or several at once) moves what's attached to it, such as satellites, and
//   anything linked only to it, which would otherwise be left behind. Everything else is held
//   still, so nothing drifts into the space it leaves. Dropped nodes are pinned where they're
//   dropped.
// - Once the map settles, wherever each node has got to is where the layout keeps it.

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
    private dragging = new Set<string>();

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
            if (pin && !this.dragging.has(node.id)) {
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
            this.holdAllBut(this.neighbourhood(added));
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

    // Starts dragging a node, or several, which then move together
    startDrag(ids: string | string[]) {
        const dragging = (typeof ids == "string" ? [ids] : ids).filter(id => this.nodes.has(id));
        if (!dragging.length) return;
        this.dragging = new Set(dragging);
        this.holdAllBut(this.followers(dragging));
        this.updateFixed();
        this.sim.alphaTarget = 0.3;
        this.sim.reheat(0.3);
    }

    // Moves a dragged node to a point, and the others being dragged with it by as much
    drag(id: string, at: Point) {
        const node = this.nodes.get(id);
        if (!node) return;
        const dx = at.x - node.x, dy = at.y - node.y;
        for (const other of this.dragging) {
            const n = this.nodes.get(other);
            if (!n) continue;
            n.x += dx;
            n.y += dy;
        }
    }

    // Drops what's being dragged, pinning it where it is, and returns where that is
    endDrag(): Map<string, Point> {
        const dropped = new Map<string, Point>();
        for (const id of this.dragging) {
            const node = this.nodes.get(id);
            if (!node) continue;
            const at = { x: Math.round(node.x), y: Math.round(node.y) };
            node.x = at.x;
            node.y = at.y;
            node.home = { ...at };
            this.pinned.set(id, at);
            dropped.set(id, at);
        }
        this.dragging = new Set();
        this.sim.alphaTarget = 0;
        this.updateFixed();
        return dropped;
    }

    isPinned(id: string) {
        return this.pinned.has(id);
    }

    // Runs the simulation for up to `budgetMs`, and says whether anything moved
    step(budgetMs: number, maxTicks = Infinity): boolean {
        if (this.sim.settled) return false;
        this.sim.run(budgetMs, maxTicks);
        if (this.sim.settled) {
            // Where things have got to is where they stay, rather than being pulled back to where
            // they were first placed the next time something moves
            for (const node of this.nodes.values()) node.home = { x: node.x, y: node.y };
            if (this.held.size) {
                this.held.clear();
                this.updateFixed();
            }
        }
        return true;
    }

    // What moves with dragged nodes: what's attached to them, and unpinned nodes linked only to
    // them (and what's attached to those)
    private followers(ids: string[]): Set<string> {
        const attached = this.layout.attached?.(this.graph) ?? new Map<string, string[]>();
        const free = new Set(ids);
        for (const id of ids) {
            for (const a of attached.get(id) ?? []) free.add(a);
        }
        const others = new Map<string, Set<string>>();
        const link = (a: string, b: string) => (others.get(a) ?? others.set(a, new Set()).get(a)!).add(b);
        for (const edge of this.graph.edges) {
            link(edge.from, edge.to);
            link(edge.to, edge.from);
        }
        const group = new Set(free);
        for (const id of group) {
            for (const n of others.get(id) ?? []) {
                if (free.has(n) || this.pinned.has(n)) continue;
                const loose = [...others.get(n)!].every(o => o == n || group.has(o) || (attached.get(n) ?? []).includes(o));
                if (!loose) continue;
                free.add(n);
                for (const a of attached.get(n) ?? []) free.add(a);
            }
        }
        return free;
    }

    // Some nodes, what they're linked to, and what's attached to any of those
    private neighbourhood(ids: string[]): Set<string> {
        const attached = this.layout.attached?.(this.graph) ?? new Map<string, string[]>();
        const centre = new Set(ids);
        const free = new Set(ids);
        for (const edge of this.graph.edges) {
            // Only one step out: checked against the nodes asked about, not what's been added
            if (centre.has(edge.from) || centre.has(edge.to)) {
                free.add(edge.from);
                free.add(edge.to);
            }
        }
        for (const id of [...free]) {
            for (const a of attached.get(id) ?? []) free.add(a);
        }
        return free;
    }

    private holdAllBut(free: Set<string>) {
        this.held.clear();
        for (const id of this.nodes.keys()) {
            if (!free.has(id)) this.held.add(id);
        }
    }

    private updateFixed() {
        for (const [id, node] of this.nodes) {
            node.fixed = this.dragging.has(id) || this.pinned.has(id) || this.held.has(id);
        }
    }
}
