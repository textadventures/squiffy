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

export interface EdgeShape {
    // An SVG path
    d: string;
    // The arrowhead's tip, and the direction it points (radians)
    tip: Point;
    angle: number;
    // Halfway along, e.g. for a label
    middle: Point;
}

// The path of an edge from one box to another, bending to the left (looking from `from` to `to`)
// by `bend` pixels at its middle, e.g. so edges both ways between two nodes don't overlap.
// Undefined if the boxes overlap, as there's nothing to draw.
export function edgeShape(from: Box, to: Box, bend = 0, gap = 2): EdgeShape | undefined {
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
    const r = (n: number) => Math.round(n * 10) / 10;
    if (!bend) {
        return {
            d: `M${r(start.x)},${r(start.y)}L${r(end.x)},${r(end.y)}`,
            tip: end,
            angle: Math.atan2(end.y - start.y, end.x - start.x),
            middle: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
        };
    }
    return {
        d: `M${r(start.x)},${r(start.y)}Q${r(control.x)},${r(control.y)} ${r(end.x)},${r(end.y)}`,
        tip: end,
        angle: Math.atan2(end.y - control.y, end.x - control.x),
        middle: {
            x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
            y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y,
        },
    };
}

// A filled arrowhead with its tip at a point, pointing in a direction
export function arrowhead(tip: Point, angle: number, size = 7): string {
    const back = angle + Math.PI;
    const spread = 0.45;
    const a = { x: tip.x + Math.cos(back - spread) * size, y: tip.y + Math.sin(back - spread) * size };
    const b = { x: tip.x + Math.cos(back + spread) * size, y: tip.y + Math.sin(back + spread) * size };
    const r = (n: number) => Math.round(n * 10) / 10;
    return `M${r(tip.x)},${r(tip.y)}L${r(a.x)},${r(a.y)}L${r(b.x)},${r(b.y)}Z`;
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
