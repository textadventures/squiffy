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

// Pans as little as possible to bring a rectangle into view (with a margin), or undefined if it's
// already in view
export function revealTransform(t: Transform, rect: Rect, view: { width: number; height: number }, margin = 32): Transform | undefined {
    const left = rect.x * t.k + t.x, top = rect.y * t.k + t.y;
    const right = left + rect.width * t.k, bottom = top + rect.height * t.k;
    let dx = 0, dy = 0;
    if (right - left > view.width - margin * 2) dx = view.width / 2 - (left + right) / 2;
    else if (left < margin) dx = margin - left;
    else if (right > view.width - margin) dx = view.width - margin - right;
    if (bottom - top > view.height - margin * 2) dy = view.height / 2 - (top + bottom) / 2;
    else if (top < margin) dy = margin - top;
    else if (bottom > view.height - margin) dy = view.height - margin - bottom;
    return dx || dy ? { ...t, x: t.x + dx, y: t.y + dy } : undefined;
}
