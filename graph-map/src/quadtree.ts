// A quadtree of weighted points, for Barnes–Hut: a cell far enough away from a point acts on it
// as one body at its centre of mass, so repulsion between n nodes costs O(n log n), not O(n²).

export interface Body {
    x: number;
    y: number;
    // The body's charge: its share of the repulsion
    weight: number;
}

export interface QuadCell<B extends Body> {
    // The cell's square
    x0: number;
    y0: number;
    size: number;
    // Total weight, and its centre of mass
    weight: number;
    cx: number;
    cy: number;
    // A leaf holds bodies; any other cell holds four children (some may be undefined)
    bodies?: B[];
    children?: (QuadCell<B> | undefined)[];
}

// Bodies per leaf before it splits. Bodies at the same point never split, so a leaf can have more.
const LEAF_SIZE = 4;
// How deep the tree can go, as a guard against bodies that are almost on top of each other
const MAX_DEPTH = 24;

export function buildQuadtree<B extends Body>(bodies: readonly B[]): QuadCell<B> | undefined {
    if (bodies.length == 0) return undefined;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of bodies) {
        if (b.x < x0) x0 = b.x;
        if (b.y < y0) y0 = b.y;
        if (b.x > x1) x1 = b.x;
        if (b.y > y1) y1 = b.y;
    }
    const size = Math.max(x1 - x0, y1 - y0, 1);
    const root = build(bodies.slice(), x0, y0, size, 0);
    return root;
}

function build<B extends Body>(bodies: B[], x0: number, y0: number, size: number, depth: number): QuadCell<B> {
    let weight = 0, sx = 0, sy = 0;
    for (const b of bodies) {
        weight += b.weight;
        sx += b.x * b.weight;
        sy += b.y * b.weight;
    }
    const cell: QuadCell<B> = {
        x0, y0, size, weight,
        cx: weight ? sx / weight : bodies[0].x,
        cy: weight ? sy / weight : bodies[0].y,
    };
    if (bodies.length <= LEAF_SIZE || depth >= MAX_DEPTH || allSamePlace(bodies)) {
        cell.bodies = bodies;
        return cell;
    }
    const half = size / 2;
    const xm = x0 + half, ym = y0 + half;
    const quarters: B[][] = [[], [], [], []];
    for (const b of bodies) {
        quarters[(b.x >= xm ? 1 : 0) + (b.y >= ym ? 2 : 0)].push(b);
    }
    cell.children = quarters.map((q, i) => q.length
        ? build(q, i & 1 ? xm : x0, i & 2 ? ym : y0, half, depth + 1)
        : undefined);
    return cell;
}

function allSamePlace(bodies: Body[]): boolean {
    const { x, y } = bodies[0];
    return bodies.every(b => b.x == x && b.y == y);
}

// Calls `visit` with each cell or body that acts on (x, y), Barnes–Hut style: a cell whose size
// over its distance is under theta counts as one body at its centre of mass. `self` is skipped.
export function visitFar<B extends Body>(
    root: QuadCell<B> | undefined,
    self: B,
    theta: number,
    visit: (x: number, y: number, weight: number) => void,
): void {
    if (!root) return;
    const theta2 = theta * theta;
    const stack: QuadCell<B>[] = [root];
    while (stack.length) {
        const cell = stack.pop()!;
        if (cell.weight == 0) continue;
        if (cell.bodies) {
            for (const b of cell.bodies) {
                if (b !== self) visit(b.x, b.y, b.weight);
            }
            continue;
        }
        const dx = cell.cx - self.x, dy = cell.cy - self.y;
        const d2 = dx * dx + dy * dy;
        // Far enough away, and not containing this body
        if (cell.size * cell.size < theta2 * d2 && !contains(cell, self)) {
            visit(cell.cx, cell.cy, cell.weight);
            continue;
        }
        for (const child of cell.children!) {
            if (child) stack.push(child);
        }
    }
}

function contains(cell: QuadCell<Body>, b: Body) {
    return b.x >= cell.x0 && b.x <= cell.x0 + cell.size && b.y >= cell.y0 && b.y <= cell.y0 + cell.size;
}
