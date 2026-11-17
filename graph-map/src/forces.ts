// The forces the layouts are built from. Each one changes velocities, scaled by alpha, and leaves
// fixed nodes to the simulation, which doesn't move them.

import { buildQuadtree, visitFar } from "./quadtree.js";
import type { Force, SimNode } from "./simulation.js";

// A tiny nudge in a random direction, to separate nodes at exactly the same point
const jiggle = (random: () => number) => (random() - 0.5) * 1e-6;

export interface ManyBodyOptions {
    // The node's charge: negative repels (the usual), positive attracts
    strength: (node: SimNode) => number;
    // Barnes–Hut accuracy: smaller is more exact and slower
    theta?: number;
    // Nodes further apart than this don't affect each other
    distanceMax?: number;
}

// Every node repels every other (Barnes–Hut, using a quadtree)
export function manyBody(options: ManyBodyOptions): Force {
    const theta = options.theta ?? 0.9;
    const distanceMax2 = (options.distanceMax ?? Infinity) ** 2;
    return (nodes, alpha, random) => {
        const bodies = nodes.map(node => ({ x: node.x, y: node.y, weight: options.strength(node), node }));
        const tree = buildQuadtree(bodies);
        for (const body of bodies) {
            const node = body.node;
            if (node.fixed) continue;
            visitFar(tree, body, theta, (x, y, weight) => {
                let dx = x - node.x, dy = y - node.y;
                if (dx == 0) dx = jiggle(random);
                if (dy == 0) dy = jiggle(random);
                let d2 = dx * dx + dy * dy;
                if (d2 >= distanceMax2) return;
                // Closer than a node's size, the force would be huge, so it's capped
                if (d2 < 100) d2 = Math.sqrt(100 * d2);
                const w = weight * alpha / d2;
                node.vx += dx * w;
                node.vy += dy * w;
            });
        }
    };
}

export interface LinkSpring {
    source: SimNode;
    target: SimNode;
    // The spring's natural length
    distance: number;
    // How hard it pulls, from 0 to 1
    strength: number;
}

// Springs pulling (or pushing) linked nodes to a distance apart. As in d3, a node with many links
// moves less than one with few, so hubs stay put.
export function springs(links: readonly LinkSpring[]): Force {
    const degree = new Map<SimNode, number>();
    for (const { source, target } of links) {
        degree.set(source, (degree.get(source) ?? 0) + 1);
        degree.set(target, (degree.get(target) ?? 0) + 1);
    }
    const bias = links.map(({ source, target }) => {
        const s = degree.get(source)!, t = degree.get(target)!;
        return s / (s + t);
    });
    return (_nodes, alpha, random) => {
        links.forEach((link, i) => {
            const { source, target } = link;
            if (source === target) return;
            let dx = target.x + target.vx - source.x - source.vx || jiggle(random);
            let dy = target.y + target.vy - source.y - source.vy || jiggle(random);
            const length = Math.sqrt(dx * dx + dy * dy);
            const l = (length - link.distance) / length * alpha * link.strength;
            dx *= l;
            dy *= l;
            // A fixed end doesn't move, so the other end takes all of it
            const b = source.fixed ? 1 : target.fixed ? 0 : bias[i];
            target.vx -= dx * b;
            target.vy -= dy * b;
            source.vx += dx * (1 - b);
            source.vy += dy * (1 - b);
        });
    };
}

// Pulls each node towards a target position on one axis, e.g. its row (y) or its home (x).
// A node without a target (undefined) isn't pulled.
export function towards(axis: "x" | "y", target: (node: SimNode) => number | undefined, strength: number | ((node: SimNode) => number)): Force {
    const v = axis == "x" ? "vx" : "vy";
    return (nodes, alpha) => {
        for (const node of nodes) {
            if (node.fixed) continue;
            const t = target(node);
            if (t === undefined) continue;
            const s = typeof strength == "number" ? strength : strength(node);
            node[v] += (t - node[axis]) * s * alpha;
        }
    };
}

export interface CollideOptions {
    // Space to keep around each box
    padding?: number;
    // How much of an overlap is undone each tick, from 0 to 1
    strength?: number;
    // Nodes that should only be pushed sideways when they overlap each other, e.g. ones held in
    // rows. Others move along whichever axis they overlap least.
    sideways?: (node: SimNode) => boolean;
}

// Keeps boxes from overlapping, by pushing overlapping pairs apart along the axis where they
// overlap least. Uses a grid, so it's about O(n) for boxes of similar sizes.
export function collide(options: CollideOptions = {}): Force {
    const padding = options.padding ?? 8;
    const strength = options.strength ?? 0.7;
    const sideways = options.sideways;
    return (nodes, _alpha, random) => {
        if (nodes.length < 2) return;
        let cell = 0;
        for (const n of nodes) cell = Math.max(cell, n.width + padding, n.height + padding);
        const grid = new Map<number, SimNode[]>();
        // A number rather than a string, as this runs for every node on every tick
        const key = (i: number, j: number) => (i + 0x8000) * 0x10000 + (j + 0x8000);
        for (const n of nodes) {
            const k = key(Math.floor((n.x + n.vx) / cell), Math.floor((n.y + n.vy) / cell));
            let list = grid.get(k);
            if (!list) grid.set(k, list = []);
            list.push(n);
        }
        for (const a of nodes) {
            const ax = a.x + a.vx, ay = a.y + a.vy;
            const ci = Math.floor(ax / cell), cj = Math.floor(ay / cell);
            for (let i = ci - 1; i <= ci + 1; i++) {
                for (let j = cj - 1; j <= cj + 1; j++) {
                    for (const b of grid.get(key(i, j)) ?? []) {
                        // Each pair once
                        if (b.id <= a.id || (a.fixed && b.fixed)) continue;
                        let dx = b.x + b.vx - ax, dy = b.y + b.vy - ay;
                        const ox = (a.width + b.width) / 2 + padding - Math.abs(dx);
                        const oy = (a.height + b.height) / 2 + padding - Math.abs(dy);
                        if (ox <= 0 || oy <= 0) continue;
                        if (dx == 0) dx = jiggle(random);
                        if (dy == 0) dy = jiggle(random);
                        const share = a.fixed ? 0 : b.fixed ? 1 : 0.5;
                        // Boxes are wider than they're tall, so moving up or down is usually less
                        if (ox < oy || (sideways?.(a) && sideways(b))) {
                            const push = ox * strength * Math.sign(dx);
                            a.vx -= push * share;
                            b.vx += push * (1 - share);
                        } else {
                            const push = oy * strength * Math.sign(dy);
                            a.vy -= push * share;
                            b.vy += push * (1 - share);
                        }
                    }
                }
            }
        }
    };
}
