import { describe, expect, test } from "vitest";
import { buildQuadtree, visitFar } from "./quadtree.js";
import { seededRandom } from "./random.js";

describe("quadtree", () => {
    const random = seededRandom(42);
    const bodies = Array.from({ length: 500 }, () => ({ x: random() * 1000, y: random() * 1000, weight: 1 + random() }));

    test("holds every body's weight", () => {
        const tree = buildQuadtree(bodies)!;
        expect(tree.weight).toBeCloseTo(bodies.reduce((a, b) => a + b.weight, 0));
    });

    test("theta 0 visits every other body exactly", () => {
        const tree = buildQuadtree(bodies);
        let weight = 0, count = 0;
        visitFar(tree, bodies[0], 0, (_x, _y, w) => {
            weight += w;
            count++;
        });
        expect(count).toBe(bodies.length - 1);
        expect(weight).toBeCloseTo(bodies.slice(1).reduce((a, b) => a + b.weight, 0));
    });

    test("Barnes–Hut approximates the force with fewer visits", () => {
        const tree = buildQuadtree(bodies);
        const force = (theta: number) => {
            let fx = 0, fy = 0, visits = 0;
            visitFar(tree, bodies[7], theta, (x, y, w) => {
                const dx = x - bodies[7].x, dy = y - bodies[7].y;
                const d2 = dx * dx + dy * dy;
                fx += dx * w / d2;
                fy += dy * w / d2;
                visits++;
            });
            return { fx, fy, visits };
        };
        const exact = force(0), approx = force(0.9);
        expect(approx.visits).toBeLessThan(exact.visits / 3);
        expect(Math.hypot(approx.fx - exact.fx, approx.fy - exact.fy)).toBeLessThan(Math.hypot(exact.fx, exact.fy) * 0.1);
    });

    test("bodies at the same point", () => {
        const same = Array.from({ length: 10 }, () => ({ x: 5, y: 5, weight: 1 }));
        let count = 0;
        visitFar(buildQuadtree(same), same[0], 0.9, () => count++);
        expect(count).toBe(9);
        expect(buildQuadtree([])).toBeUndefined();
    });
});
