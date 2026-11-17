// A force simulation, in the style of d3-force: each tick, forces nudge the nodes' velocities,
// then the nodes move and slow down. "alpha" is the temperature: it scales every force and cools
// towards zero, so the picture settles. Reheating it makes the nodes move again, e.g. while one
// is dragged, which pulls its neighbours along until the map "boings" back into shape.

import { seededRandom } from "./random.js";

export interface SimNode {
    id: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    width: number;
    height: number;
    // Doesn't move: it's pinned by the host, being dragged, or held still while new nodes settle
    fixed: boolean;
    // Where it was placed, which a layout can pull it back towards
    home?: { x: number; y: number };
}

// Changes nodes' velocities, scaled by alpha
export type Force = (nodes: readonly SimNode[], alpha: number, random: () => number) => void;

export interface SimulationOptions {
    // How quickly alpha cools, per tick (d3's default takes 300 ticks to reach alphaMin)
    alphaDecay?: number;
    // Below this, the simulation has settled and stops
    alphaMin?: number;
    // The fraction of its velocity a node loses each tick, like friction
    velocityDecay?: number;
    // The seed for the jiggle that separates nodes at the same point
    seed?: number;
}

export class Simulation {
    nodes: SimNode[] = [];
    forces: Force[] = [];
    alpha = 1;
    // What alpha cools towards: above alphaMin while something's being dragged, to keep it live
    alphaTarget = 0;
    readonly alphaMin: number;
    readonly alphaDecay: number;
    readonly velocityDecay: number;
    private random: () => number;

    constructor(options: SimulationOptions = {}) {
        this.alphaMin = options.alphaMin ?? 0.001;
        this.alphaDecay = options.alphaDecay ?? 1 - Math.pow(this.alphaMin, 1 / 300);
        this.velocityDecay = options.velocityDecay ?? 0.4;
        this.random = seededRandom(options.seed ?? 1);
    }

    get settled(): boolean {
        return this.alpha < this.alphaMin && this.alphaTarget < this.alphaMin;
    }

    // Raises the temperature, so the nodes move again
    reheat(alpha = 1) {
        this.alpha = Math.max(this.alpha, alpha);
    }

    tick(count = 1) {
        for (let i = 0; i < count; i++) {
            this.alpha += (this.alphaTarget - this.alpha) * this.alphaDecay;
            for (const force of this.forces) force(this.nodes, this.alpha, this.random);
            const keep = 1 - this.velocityDecay;
            for (const node of this.nodes) {
                if (node.fixed) {
                    node.vx = node.vy = 0;
                    continue;
                }
                node.vx *= keep;
                node.vy *= keep;
                node.x += node.vx;
                node.y += node.vy;
            }
        }
    }

    // Ticks until settled or out of time, and says whether it settled
    run(budgetMs: number, maxTicks = Infinity): boolean {
        const start = performance.now();
        let ticks = 0;
        while (!this.settled && ticks < maxTicks) {
            this.tick();
            ticks++;
            if ((ticks & 3) == 0 && performance.now() - start > budgetMs) break;
        }
        return this.settled;
    }
}
