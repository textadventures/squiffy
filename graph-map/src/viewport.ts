// Pan and zoom: a transform from the map's coordinates to the screen's, screen = map * k + (x, y).

import type { Point, Rect } from "./types.js";

export interface Transform {
    x: number;
    y: number;
    k: number;
}

export const identity: Transform = { x: 0, y: 0, k: 1 };

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 3;

export const toScreen = (t: Transform, p: Point): Point => ({ x: p.x * t.k + t.x, y: p.y * t.k + t.y });
export const toMap = (t: Transform, p: Point): Point => ({ x: (p.x - t.x) / t.k, y: (p.y - t.y) / t.k });

const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

// Zooms by a factor, keeping a point on the screen (e.g. under the pointer) where it is
export function zoomAt(t: Transform, factor: number, at: Point): Transform {
    const k = clampZoom(t.k * factor);
    const f = k / t.k;
    return { k, x: at.x - (at.x - t.x) * f, y: at.y - (at.y - t.y) * f };
}

// Zooms by a factor around a rectangle, such as the selected node, if its centre's in view, and
// then keeps the whole of it in view; or else around the middle of the view
export function zoomOn(t: Transform, factor: number, view: { width: number; height: number }, rect?: Rect): Transform {
    const middle = { x: view.width / 2, y: view.height / 2 };
    if (!rect) return zoomAt(t, factor, middle);
    const at = toScreen(t, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    if (at.x < 0 || at.y < 0 || at.x > view.width || at.y > view.height) return zoomAt(t, factor, middle);
    const zoomed = zoomAt(t, factor, at);
    return revealTransform(zoomed, rect, view) ?? zoomed;
}

// Shows the whole of a rectangle in a view, centred, no bigger than `maxZoom`
export function fitTransform(bounds: Rect, view: { width: number; height: number }, padding = 24, maxZoom = 1): Transform {
    const w = Math.max(1, view.width - padding * 2), h = Math.max(1, view.height - padding * 2);
    const k = clampZoom(Math.min(maxZoom, w / Math.max(bounds.width, 1), h / Math.max(bounds.height, 1)));
    return {
        k,
        x: view.width / 2 - (bounds.x + bounds.width / 2) * k,
        y: view.height / 2 - (bounds.y + bounds.height / 2) * k,
    };
}

const overlaps = (a: Rect, b: Rect) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// Pans as little as possible to bring a rectangle into view, or undefined if it's in view already.
// It only pans if some of the rectangle is out of view, or under one of `over` (in the view's
// coordinates, e.g. a panel over the map), and then leaves a margin around it.
export function revealTransform(
    t: Transform, rect: Rect, view: { width: number; height: number }, margin = 32, over: readonly Rect[] = [],
): Transform | undefined {
    const box = { x: rect.x * t.k + t.x, y: rect.y * t.k + t.y, width: rect.width * t.k, height: rect.height * t.k };
    const inView = box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width && box.y + box.height <= view.height;
    if (inView && !over.some(o => overlaps(box, o))) return undefined;
    // Into the view, along whichever way it's out of it
    let dx = 0, dy = 0;
    if (box.x < 0 || box.x + box.width > view.width) {
        if (box.width > view.width - margin * 2) dx = view.width / 2 - (box.x + box.width / 2);
        else if (box.x < margin) dx = margin - box.x;
        else dx = view.width - margin - (box.x + box.width);
    }
    if (box.y < 0 || box.y + box.height > view.height) {
        if (box.height > view.height - margin * 2) dy = view.height / 2 - (box.y + box.height / 2);
        else if (box.y < margin) dy = margin - box.y;
        else dy = view.height - margin - (box.y + box.height);
    }
    // Then out from under what's over it, the shortest way that keeps it in view
    const gap = margin / 2;
    for (const o of over) {
        const b = { ...box, x: box.x + dx, y: box.y + dy };
        if (!overlaps(b, o)) continue;
        const moves = [
            { dx: 0, dy: o.y - gap - (b.y + b.height) },
            { dx: 0, dy: o.y + o.height + gap - b.y },
            { dx: o.x - gap - (b.x + b.width), dy: 0 },
            { dx: o.x + o.width + gap - b.x, dy: 0 },
        ];
        const fits = (m: { dx: number; dy: number }) => b.x + m.dx >= 0 && b.y + m.dy >= 0
            && b.x + b.width + m.dx <= view.width && b.y + b.height + m.dy <= view.height;
        const size = (m: { dx: number; dy: number }) => Math.abs(m.dx) + Math.abs(m.dy);
        const best = (moves.filter(fits).length ? moves.filter(fits) : moves.slice(0, 1)).sort((a, c) => size(a) - size(c))[0];
        dx += best.dx;
        dy += best.dy;
    }
    return dx || dy ? { ...t, x: t.x + dx, y: t.y + dy } : undefined;
}
