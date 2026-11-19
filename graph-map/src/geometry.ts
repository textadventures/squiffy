// Drawing edges between boxes: where a line leaves a box, curved paths, and arrowheads.

import type { Point, Rect } from "./types.js";

export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

// Where a line from the centre of a box towards a point crosses the box's edge (plus a gap). The
// centre itself if the point is inside.
export function exitPoint(box: Box, toward: Point, gap = 0): Point {
    const dx = toward.x - box.x, dy = toward.y - box.y;
    const hw = box.width / 2 + gap, hh = box.height / 2 + gap;
    if (dx == 0 && dy == 0) return { x: box.x, y: box.y };
    // The fraction of the way to `toward` at which the line meets each side
    const tx = dx == 0 ? Infinity : hw / Math.abs(dx);
    const ty = dy == 0 ? Infinity : hh / Math.abs(dy);
    const t = Math.min(tx, ty);
    if (t >= 1) return { x: box.x, y: box.y };
    return { x: box.x + dx * t, y: box.y + dy * t };
}

// Where an edge goes: a straight line from `start` to `end`, or a quadratic curve through `control`
export interface EdgeGeometry {
    start: Point;
    end: Point;
    control?: Point;
    // The arrowhead's tip, and the direction it points (radians)
    tip: Point;
    angle: number;
    // Halfway along, e.g. for a label
    middle: Point;
}

export interface EdgeShape extends EdgeGeometry {
    // An SVG path
    d: string;
}

// Where an edge from one box to another goes, bending to the left (looking from `from` to `to`)
// by `bend` pixels at its middle, e.g. so edges both ways between two nodes don't overlap.
// Undefined if the boxes overlap, as there's nothing to draw.
export function edgeGeometry(from: Box, to: Box, bend = 0, gap = 2): EdgeGeometry | undefined {
    const dx = to.x - from.x, dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length == 0) return undefined;
    // The control point of a quadratic curve, off the midpoint at right angles
    const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
    const nx = dy / length, ny = -dx / length;
    // A quadratic's middle is halfway to its control point, so the control point is twice as far
    const control = { x: mx + nx * bend * 2, y: my + ny * bend * 2 };
    const start = exitPoint(from, bend ? control : to, gap);
    const end = exitPoint(to, bend ? control : from, gap);
    if ((start.x == from.x && start.y == from.y) || (end.x == to.x && end.y == to.y)) return undefined;
    if (!bend) {
        return {
            start,
            end,
            tip: end,
            angle: Math.atan2(end.y - start.y, end.x - start.x),
            middle: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
        };
    }
    return {
        start,
        end,
        control,
        tip: end,
        angle: Math.atan2(end.y - control.y, end.x - control.x),
        middle: {
            x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
            y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y,
        },
    };
}

// The same, with an SVG path
export function edgeShape(from: Box, to: Box, bend = 0, gap = 2): EdgeShape | undefined {
    const g = edgeGeometry(from, to, bend, gap);
    if (!g) return undefined;
    const r = (n: number) => Math.round(n * 10) / 10;
    const d = g.control
        ? `M${r(g.start.x)},${r(g.start.y)}Q${r(g.control.x)},${r(g.control.y)} ${r(g.end.x)},${r(g.end.y)}`
        : `M${r(g.start.x)},${r(g.start.y)}L${r(g.end.x)},${r(g.end.y)}`;
    return { ...g, d };
}

// The corners of a filled arrowhead with its tip at a point, pointing in a direction: the tip,
// then the two back corners
export function arrowPoints(tip: Point, angle: number, size = 7): [Point, Point, Point] {
    const back = angle + Math.PI;
    const spread = 0.45;
    return [
        tip,
        { x: tip.x + Math.cos(back - spread) * size, y: tip.y + Math.sin(back - spread) * size },
        { x: tip.x + Math.cos(back + spread) * size, y: tip.y + Math.sin(back + spread) * size },
    ];
}

// The same, as an SVG path
export function arrowhead(tip: Point, angle: number, size = 7): string {
    const [, a, b] = arrowPoints(tip, angle, size);
    const r = (n: number) => Math.round(n * 10) / 10;
    return `M${r(tip.x)},${r(tip.y)}L${r(a.x)},${r(a.y)}L${r(b.x)},${r(b.y)}Z`;
}

// The rectangle an edge's line stays within (a quadratic curve stays within its control points)
export function edgeBounds(g: EdgeGeometry): Rect {
    // Without arrays: this runs for every edge, every frame
    const c = g.control ?? g.start;
    const x = Math.min(g.start.x, g.end.x, c.x), y = Math.min(g.start.y, g.end.y, c.y);
    return { x, y, width: Math.max(g.start.x, g.end.x, c.x) - x, height: Math.max(g.start.y, g.end.y, c.y) - y };
}

// How far a point is from an edge's line
export function distanceToEdge(g: EdgeGeometry, p: Point): number {
    if (!g.control) return distanceToSegment(p, g.start, g.end);
    // Near enough, as a chain of short lines along the curve
    const steps = 16;
    let best = Infinity;
    let previous = g.start;
    for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        const next = {
            x: u * u * g.start.x + 2 * u * t * g.control.x + t * t * g.end.x,
            y: u * u * g.start.y + 2 * u * t * g.control.y + t * t * g.end.y,
        };
        best = Math.min(best, distanceToSegment(p, previous, next));
        previous = next;
    }
    return best;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 == 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// The smallest rectangle around every box
export function boundsOf(boxes: Iterable<Box>): Rect | undefined {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of boxes) {
        x0 = Math.min(x0, b.x - b.width / 2);
        y0 = Math.min(y0, b.y - b.height / 2);
        x1 = Math.max(x1, b.x + b.width / 2);
        y1 = Math.max(y1, b.y + b.height / 2);
    }
    return x0 == Infinity ? undefined : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// The nearest box in a direction from another, for moving between nodes with the arrow keys.
// Boxes more ahead than to the side are preferred.
export function nearestInDirection<B extends Box>(from: Box, boxes: Iterable<B>, direction: "up" | "down" | "left" | "right"): B | undefined {
    let best: B | undefined;
    let bestScore = Infinity;
    for (const b of boxes) {
        if (b === from) continue;
        const dx = b.x - from.x, dy = b.y - from.y;
        const ahead = direction == "right" ? dx : direction == "left" ? -dx : direction == "down" ? dy : -dy;
        const side = direction == "left" || direction == "right" ? Math.abs(dy) : Math.abs(dx);
        if (ahead <= 0) continue;
        const score = ahead + side * 2;
        if (score < bestScore) {
            bestScore = score;
            best = b;
        }
    }
    return best;
}
