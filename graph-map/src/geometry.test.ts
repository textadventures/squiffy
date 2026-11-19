import { describe, expect, test } from "vitest";
import { arrowhead, arrowPoints, boundsOf, distanceToEdge, edgeBounds, edgeGeometry, edgeShape, exitPoint, nearestInDirection } from "./geometry.js";
import { fitTransform, revealTransform, toMap, toScreen, zoomAt } from "./viewport.js";

const box = (x: number, y: number, width = 100, height = 40) => ({ x, y, width, height });

describe("geometry", () => {
    test("where a line leaves a box", () => {
        expect(exitPoint(box(0, 0), { x: 200, y: 0 })).toEqual({ x: 50, y: 0 });
        expect(exitPoint(box(0, 0), { x: 0, y: -200 })).toEqual({ x: 0, y: -20 });
        expect(exitPoint(box(0, 0), { x: 100, y: 100 }, 2)).toEqual({ x: 22, y: 22 });
        // Inside: the centre
        expect(exitPoint(box(0, 0), { x: 10, y: 5 })).toEqual({ x: 0, y: 0 });
    });

    test("a straight edge runs between the boxes' edges, with the arrow pointing at the target", () => {
        const shape = edgeShape(box(0, 0), box(0, 200), 0, 0)!;
        expect(shape.d).toBe("M0,20L0,180");
        expect(shape.tip).toEqual({ x: 0, y: 180 });
        expect(shape.angle).toBeCloseTo(Math.PI / 2);
    });

    test("a bent edge curves to one side", () => {
        const shape = edgeShape(box(0, 0), box(0, 200), 20, 0)!;
        expect(shape.d.startsWith("M")).toBe(true);
        expect(shape.d).toContain("Q");
        // Going down, left is +x (roughly the bend, as the ends leave the boxes towards the curve)
        expect(shape.middle.x).toBeGreaterThan(15);
        expect(shape.middle.x).toBeLessThan(30);
    });

    test("no edge between overlapping boxes", () => {
        expect(edgeShape(box(0, 0), box(10, 0), 0)).toBeUndefined();
    });

    test("an edge's geometry is what its path draws", () => {
        const straight = edgeGeometry(box(0, 0), box(0, 200), 0, 0)!;
        expect(straight).toMatchObject({ start: { x: 0, y: 20 }, end: { x: 0, y: 180 } });
        expect(straight.control).toBeUndefined();
        const bent = edgeGeometry(box(0, 0), box(0, 200), 20, 0)!;
        expect(bent.control).toEqual({ x: 40, y: 100 });
        expect(edgeShape(box(0, 0), box(0, 200), 20, 0)!.d).toContain("Q40,100 ");
    });

    test("arrowheads", () => {
        const [tip, a, b] = arrowPoints({ x: 0, y: 0 }, 0, 10);
        expect(tip).toEqual({ x: 0, y: 0 });
        // Pointing right, so the back corners are to the left, either side of the line
        expect(a.x).toBeLessThan(-8);
        expect(b.x).toBeCloseTo(a.x);
        expect(a.y).toBeCloseTo(-b.y);
        expect(arrowhead({ x: 0, y: 0 }, 0, 10)).toBe("M0,0L-9,4.3L-9,-4.3Z");
    });

    test("how far a point is from an edge", () => {
        const straight = edgeGeometry(box(0, 0), box(0, 200), 0, 0)!;
        expect(distanceToEdge(straight, { x: 5, y: 100 })).toBeCloseTo(5);
        // Past the end: the distance to the end
        expect(distanceToEdge(straight, { x: 0, y: 190 })).toBeCloseTo(10);
        const bent = edgeGeometry(box(0, 0), box(0, 200), 20, 0)!;
        // The curve's middle is out to the side, not on the straight line between the boxes
        expect(distanceToEdge(bent, bent.middle)).toBeLessThan(0.5);
        expect(distanceToEdge(bent, { x: 0, y: 100 })).toBeGreaterThan(15);
    });

    test("an edge's bounds take in its curve", () => {
        const bent = edgeGeometry(box(0, 0), box(0, 200), 20, 0)!;
        const b = edgeBounds(bent);
        expect(b.x).toBeLessThanOrEqual(bent.start.x);
        expect(b.x + b.width).toBe(40);
        expect(b.y).toBe(bent.start.y);
    });

    test("bounds", () => {
        expect(boundsOf([box(0, 0), box(200, 100)])).toEqual({ x: -50, y: -20, width: 300, height: 140 });
        expect(boundsOf([])).toBeUndefined();
    });

    test("the nearest box in a direction prefers ones straight ahead", () => {
        const from = box(0, 0);
        const ahead = box(0, 150), aside = box(100, 100), behind = box(0, -100);
        expect(nearestInDirection(from, [from, ahead, aside, behind], "down")).toBe(ahead);
        expect(nearestInDirection(from, [from, ahead, aside, behind], "up")).toBe(behind);
        expect(nearestInDirection(from, [from, behind], "down")).toBeUndefined();
    });
});

describe("viewport", () => {
    test("zooming keeps the point under the pointer still", () => {
        const t = { x: 10, y: 20, k: 1 };
        const at = { x: 300, y: 200 };
        const before = toMap(t, at);
        const zoomed = zoomAt(t, 2, at);
        expect(zoomed.k).toBe(2);
        expect(toScreen(zoomed, before)).toEqual(at);
        expect(zoomAt(t, 1000, at).k).toBe(3);
    });

    test("fitting centres the bounds, no bigger than full size", () => {
        const t = fitTransform({ x: 0, y: 0, width: 100, height: 100 }, { width: 500, height: 300 }, 0);
        expect(t).toEqual({ k: 1, x: 200, y: 100 });
        const big = fitTransform({ x: 0, y: 0, width: 1000, height: 200 }, { width: 500, height: 300 }, 0);
        expect(big.k).toBe(0.5);
        expect(toScreen(big, { x: 500, y: 100 })).toEqual({ x: 250, y: 150 });
    });

    test("revealing pans just enough", () => {
        const view = { width: 400, height: 300 };
        const t = { x: 0, y: 0, k: 1 };
        expect(revealTransform(t, { x: 100, y: 100, width: 50, height: 20 }, view, 10)).toBeUndefined();
        expect(revealTransform(t, { x: 500, y: 100, width: 50, height: 20 }, view, 10)).toEqual({ x: -160, y: 0, k: 1 });
    });
});
