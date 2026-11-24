<script lang="ts" module>
    import type { Snippet } from "svelte";
    import type { Layout, MapEdge, MapGraph, MapNode, Point } from "@textadventures/graph-map";

    export interface GraphMapProps<N extends MapNode, E extends MapEdge> {
        graph: MapGraph<N, E>;
        // Made once: changing it later has no effect
        layout: Layout<N, E>;
        // Where the host has pinned nodes, e.g. positions the author chose, saved with the project
        pinned?: ReadonlyMap<string, Point>;
        // The selected node's id
        selected?: string | null;
        // Edges longer than this (between the centres of their ends) are drawn faintly, so that
        // links across the map don't hide the links between neighbours, unless they're hovered
        // or one of their ends is selected. Infinity draws them all the same. Default 400.
        longEdge?: number;
        // What the map is, for screen readers, e.g. "Story map"
        label: string;
        // Read out with the label: how to use the map
        instructions?: string;
        // Draws a node, inside a <g> whose origin is the node's top left corner
        node?: Snippet<[N, NodeState]>;
        // Whether a link can be dragged from one node to another (or to empty space, with null)
        canConnect?: (from: N, to: N | null) => boolean;
        // A node was clicked ("click"), or double-clicked or Enter pressed on it ("open")
        onactivate?: (node: N, how: "click" | "open") => void;
        onedgeactivate?: (edge: E) => void;
        // Nodes were dropped somewhere (one, or several dragged together), and are now pinned there
        onmove?: (moves: { node: N; at: Point }[]) => void;
        // A link was dragged from one node to another, or to empty space (`to` is null)
        onconnect?: (from: N, to: N | null, at: Point) => void;
        // The background was double-clicked
        oncreate?: (at: Point) => void;
        // F2 on a node
        onrename?: (node: N) => void;
        // Delete or Backspace: the selected node, or the nodes selected together
        ondelete?: (nodes: N[]) => void;
        // A right-click (or a long press, or the menu key or Shift+F10 for the selected node) on
        // a node, which is selected first, or on the background. `at` is the point on the map and
        // `screen` the point in the window to show a menu at. Without this, the browser's own
        // menu is shown.
        onmenu?: (node: N | null, at: Point, screen: Point, keyboard: boolean) => void;
    }

    export interface NodeState {
        selected: boolean;
        // A link is being dragged, and would go to this node if dropped here
        target: boolean;
        // Being dragged
        dragging: boolean;
    }
</script>

<script lang="ts" generics="N extends MapNode, E extends MapEdge">
    // A map of a directed graph, drawn as SVG: boxes and arrows, with pan and zoom (drag the
    // background, scroll, pinch, or Ctrl/Cmd+scroll to zoom), dragging nodes (which pins them where
    // they're dropped), selecting several with Shift+drag (a lasso) or Shift+click to drag them
    // together, drag-to-link from a node's handle, and keyboard access (arrow keys move
    // between nodes, Enter activates one). The layout is live: see MapModel. Knows nothing about
    // what the graph is of: the host gives it nodes and edges, styles them through their classes,
    // and can draw nodes its own way with the `node` snippet.
    import { onMount, untrack } from "svelte";
    import {
        arrowhead, arrowPoints, boundsOf, distanceToEdge, edgeBounds, edgeGeometry, edgeShape, fitTransform, identity, MapModel,
        nearestInDirection, revealTransform, toMap, zoomAt, type EdgeGeometry, type Rect, type Transform,
    } from "@textadventures/graph-map";


    const NONE: ReadonlyMap<string, Point> = new Map();

    let {
        graph, layout, pinned = NONE, selected = $bindable(null), longEdge = 400, label, instructions, node: drawNode, canConnect,
        onactivate, onedgeactivate, onmove, onconnect, oncreate, onrename, ondelete, onmenu,
    }: GraphMapProps<N, E> = $props();

    // svelte-ignore state_referenced_locally
    const model = new MapModel<N, E>(layout);
    let transform = $state<Transform>(identity);
    let width = $state(0);
    let height = $state(0);
    let container = $state<HTMLDivElement>();
    // Fit the whole graph in view until the viewer pans or zooms
    let autoFit = true;
    // Run the simulation as fast as it'll go (laying out from scratch) or a tick a frame (live)
    let fast = true;
    let raf = 0;
    let announcement = $state("");
    // The viewer has asked their system for less motion: the map doesn't show the nodes moving
    // into place, only where they end up (or, for a big map that takes a while, where they've
    // got to every second or so). Nodes still follow a drag.
    let reduceMotion = false;
    // While reducing motion, when the moving nodes were last drawn
    let shownAt = 0;

    const nodesById = $derived(new Map(graph.nodes.map(n => [n.id, n])));

    $effect(() => {
        const g = graph, p = pinned;
        untrack(() => {
            model.update(g, p);
            if (selected && !nodesById.has(selected)) selected = null;
            paint();
            wake();
        });
    });

    onMount(() => {
        // Edges' styles can change with the page's theme, e.g. a class or color-scheme on <html>
        const restyle = () => {
            edgeStyles.clear();
            scheduleDraw();
        };
        const observer = new MutationObserver(restyle);
        observer.observe(document.documentElement, { attributes: true });
        const media = matchMedia("(prefers-color-scheme: dark)");
        media.addEventListener("change", restyle);
        const motion = matchMedia("(prefers-reduced-motion: reduce)");
        const updateMotion = () => { reduceMotion = motion.matches; };
        updateMotion();
        motion.addEventListener("change", updateMotion);
        return () => {
            observer.disconnect();
            media.removeEventListener("change", restyle);
            motion.removeEventListener("change", updateMotion);
            cancelAnimationFrame(raf);
            cancelAnimationFrame(drawRaf);
        };
    });

    // Runs the simulation while it's moving
    function wake() {
        if (raf || typeof requestAnimationFrame == "undefined") return;
        raf = requestAnimationFrame(loop);
    }

    // How long the last drawing took, and when it finished
    let drawMs = 0;
    let drewAt = 0;
    // The nodes have moved since they were drawn
    let stale = false;

    function loop() {
        raf = 0;
        // A big map takes a while to draw, so each frame either moves the nodes or draws them,
        // and drawing gets at most half the time. That keeps each piece of work short, so the
        // page stays responsive while the map lays itself out.
        const slow = drawMs > 8;
        // Reducing motion, the simulation runs as fast as it can, as it does laying out from
        // scratch, and the nodes are only drawn once they've stopped, unless they're being dragged
        const still = reduceMotion && gesture?.kind != "node";
        // Whether moving nodes can be drawn where they've got to
        const show = () => !still || model.settled || performance.now() - shownAt >= 1000;
        if (slow && stale && performance.now() - drewAt >= drawMs && show()) {
            draw();
        } else {
            const quick = fast || reduceMotion;
            const moved = model.step(quick ? 12 : 4, quick ? Infinity : 1);
            if (model.settled) fast = false;
            if (moved) stale = true;
            if (stale && !slow && show()) draw();
        }
        if (!model.settled || stale) raf = requestAnimationFrame(loop);
    }

    function draw() {
        // Fitted first, so the edges are drawn once, where they'll be seen
        if (autoFit) fit(false);
        paint();
    }

    // ---- The view ----

    // Nodes' positions are written straight to their elements on each frame, rather than through
    // Svelte, which would check every node in the template each time: too slow for a story with
    // hundreds of sections while it's moving.
    const nodeEls = new Map<string, SVGGElement>();

    const box = (id: string) => {
        const p = model.position(id), n = nodesById.get(id);
        return p && n ? { x: p.x, y: p.y, width: n.width, height: n.height } : undefined;
    };

    function paintNode(id: string) {
        const el = nodeEls.get(id), p = model.position(id), n = nodesById.get(id);
        if (!el || !p || !n) return;
        // A CSS transform rather than the transform attribute, which is slower to redraw
        el.style.transform = `translate(${Math.round((p.x - n.width / 2) * 10) / 10}px,${Math.round((p.y - n.height / 2) * 10) / 10}px)`;
    }

    function paint() {
        const started = performance.now();
        for (const n of graph.nodes) paintNode(n.id);
        drawEdges();
        stale = false;
        drewAt = shownAt = performance.now();
        drawMs = drewAt - started;
    }

    // ---- Edges ----

    // Edges are drawn on a canvas under the nodes. An SVG element for each was far too slow to
    // redraw once a story had a few thousand links: every frame the layout moves, and every pan
    // and zoom. They're still styled with CSS, by their class: see edgeStyle.
    let canvas = $state<HTMLCanvasElement>();
    // Holds the elements edgeStyle looks styles up on
    let probes = $state<SVGGElement>();
    let hovered = $state<string | null>(null);
    const hoveredEdge = $derived(hovered === null ? undefined : graph.edges.find(e => e.id == hovered));

    interface DrawnEdge {
        edge: E;
        geometry: EdgeGeometry;
        bounds: Rect;
    }
    // Every edge as last drawn (on screen or not), to find the one under the pointer
    let drawn: DrawnEdge[] = [];
    // What the edges were last drawn with, so they're only drawn again when it changes
    let drawnWith: { transform: Transform; width: number; height: number; selected: string | null; hovered: string | null } | null = null;
    let drawRaf = 0;
    let needsDraw = false;

    interface EdgeStyle {
        stroke: string | null;
        width: number;
        dash: number[];
        cap: CanvasLineCap;
        strokeAlpha: number;
        fill: string | null;
        fillAlpha: number;
    }
    // By class and state. Cleared when the page's theme might have changed.
    const edgeStyles = new Map<string, EdgeStyle>();
    const SVG = "http://www.w3.org/2000/svg";

    // How an edge looks: what CSS gives an SVG edge with its class and state (a <g class="gm-edge">
    // with a .gm-edge-line and a .gm-edge-arrow, as the host's styles expect). Each combination
    // is looked up once, on a hidden element.
    function edgeStyle(cls: string, isSelected: boolean, isHovered: boolean, long: boolean): EdgeStyle {
        const key = `${+isSelected}${+isHovered}${+long} ${cls}`;
        let style = edgeStyles.get(key);
        if (style) return style;
        const g = document.createElementNS(SVG, "g");
        g.setAttribute("class", `gm-edge ${cls}${isSelected ? " gm-edge-selected" : ""}${isHovered ? " gm-edge-hover" : ""}`);
        if (long) g.setAttribute("data-long", "");
        const line = document.createElementNS(SVG, "path");
        line.setAttribute("class", "gm-edge-line");
        const arrow = document.createElementNS(SVG, "path");
        arrow.setAttribute("class", "gm-edge-arrow");
        g.append(line, arrow);
        probes!.append(g);
        const gs = getComputedStyle(g), ls = getComputedStyle(line), as = getComputedStyle(arrow);
        const paintOf = (value: string) => !value || value == "none" || value.startsWith("url(") ? null : value;
        const opacity = num(gs.opacity, 1);
        const dash = ls.strokeDasharray == "none" ? [] : ls.strokeDasharray.split(/[\s,]+/).map(parseFloat).filter(n => n >= 0);
        style = {
            stroke: paintOf(ls.stroke),
            width: num(ls.strokeWidth, 1),
            // All zeros is a solid line, as in SVG
            dash: dash.some(n => n > 0) ? dash : [],
            cap: (["butt", "round", "square"].includes(ls.strokeLinecap) ? ls.strokeLinecap : "butt") as CanvasLineCap,
            strokeAlpha: opacity * num(ls.opacity, 1) * num(ls.strokeOpacity, 1),
            fill: paintOf(as.fill),
            fillAlpha: opacity * num(as.opacity, 1) * num(as.fillOpacity, 1),
        };
        g.remove();
        edgeStyles.set(key, style);
        return style;
    }

    function num(value: string, fallback: number) {
        const n = parseFloat(value);
        return Number.isFinite(n) ? n : fallback;
    }

    // Draws the edges at the next frame, unless the layout does first
    function scheduleDraw() {
        needsDraw = true;
        if (drawRaf || typeof requestAnimationFrame == "undefined") return;
        drawRaf = requestAnimationFrame(() => {
            drawRaf = 0;
            if (needsDraw) drawEdges();
        });
    }

    function drawEdges() {
        needsDraw = false;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx || !probes) return;
        const ratio = window.devicePixelRatio || 1;
        const w = Math.round(width * ratio), h = Math.round(height * ratio);
        if (canvas.width != w) canvas.width = w;
        if (canvas.height != h) canvas.height = h;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const t = transform;
        drawnWith = { transform: t, width, height, selected, hovered };
        ctx.setTransform(ratio * t.k, 0, 0, ratio * t.k, ratio * t.x, ratio * t.y);

        // What's in view, on the map, with room for arrowheads
        const margin = 10;
        const x0 = -t.x / t.k - margin, y0 = -t.y / t.k - margin;
        const x1 = (width - t.x) / t.k + margin, y1 = (height - t.y) / t.k + margin;
        // Edges that look the same are drawn together, which is much quicker than one at a time.
        // The selected node's edges go on top, and the hovered edge above them.
        const layers = [new Map<EdgeStyle, DrawnEdge[]>(), new Map<EdgeStyle, DrawnEdge[]>(), new Map<EdgeStyle, DrawnEdge[]>()];
        const next: DrawnEdge[] = [];
        for (const edge of graph.edges) {
            const a = box(edge.from), b = box(edge.to);
            if (!a || !b) continue;
            const geometry = edgeGeometry(a, b, bends.get(edge.id) ?? 0, 3);
            if (!geometry) continue;
            const item = { edge, geometry, bounds: edgeBounds(geometry) };
            next.push(item);
            const r = item.bounds;
            if (r.x > x1 || r.y > y1 || r.x + r.width < x0 || r.y + r.height < y0) continue;
            const isSelected = selected !== null && (edge.from == selected || edge.to == selected);
            const isHovered = edge.id == hovered;
            const style = edgeStyle(edge.class ?? "", isSelected, isHovered, Math.hypot(b.x - a.x, b.y - a.y) > longEdge);
            const layer = layers[isHovered ? 2 : isSelected ? 1 : 0];
            let list = layer.get(style);
            if (!list) layer.set(style, list = []);
            list.push(item);
        }
        drawn = next;

        for (const layer of layers) {
            for (const [style, items] of layer) {
                if (style.stroke && style.strokeAlpha > 0) {
                    ctx.globalAlpha = style.strokeAlpha;
                    ctx.strokeStyle = style.stroke;
                    ctx.lineWidth = style.width;
                    ctx.lineCap = style.cap;
                    ctx.setLineDash(style.dash);
                    inBatches(items, g => {
                        ctx.moveTo(g.start.x, g.start.y);
                        if (g.control) ctx.quadraticCurveTo(g.control.x, g.control.y, g.end.x, g.end.y);
                        else ctx.lineTo(g.end.x, g.end.y);
                    }, () => ctx.stroke());
                }
                if (style.fill && style.fillAlpha > 0) {
                    ctx.globalAlpha = style.fillAlpha;
                    ctx.fillStyle = style.fill;
                    // fill() closes each triangle. closePath() would too, but it slows down badly as
                    // a path gets longer.
                    inBatches(items, g => {
                        const [tip, a, b] = arrowPoints(g.tip, g.angle);
                        ctx.moveTo(tip.x, tip.y);
                        ctx.lineTo(a.x, a.y);
                        ctx.lineTo(b.x, b.y);
                    }, () => ctx.fill());
                }
            }
        }
        ctx.globalAlpha = 1;

        // Adds edges to the path a batch at a time, drawing each batch: a canvas path with too
        // many parts in it gets slower to build
        function inBatches(items: DrawnEdge[], add: (g: EdgeGeometry) => void, draw: () => void) {
            for (let i = 0; i < items.length; i += 1000) {
                ctx!.beginPath();
                for (const item of items.slice(i, i + 1000)) add(item.geometry);
                draw();
            }
        }
    }

    // Panning, zooming, resizing, selecting and hovering draw the edges again, if the layout
    // hasn't already drawn them as they are
    $effect(() => {
        const now = { transform, width, height, selected, hovered };
        untrack(() => {
            const was = drawnWith;
            if (!was || now.transform !== was.transform || now.width != was.width || now.height != was.height
                || now.selected != was.selected || now.hovered != was.hovered) scheduleDraw();
        });
    });

    // The edge under a point on the map, if any: the nearest one within a few pixels
    function edgeAt(p: Point): E | undefined {
        const tolerance = Math.max(5, 3 / transform.k);
        let best: E | undefined;
        let bestDistance = tolerance;
        for (const { edge, geometry, bounds: r } of drawn) {
            if (p.x < r.x - tolerance || p.x > r.x + r.width + tolerance || p.y < r.y - tolerance || p.y > r.y + r.height + tolerance) continue;
            const d = distanceToEdge(geometry, p);
            if (d <= bestDistance) {
                bestDistance = d;
                best = edge;
            }
        }
        return best;
    }

    function updateHover(e: PointerEvent) {
        const overNode = (e.target as Element).closest("[data-node], [data-handle]");
        hovered = overNode ? null : edgeAt(toMap(transform, local(e)))?.id ?? null;
    }

    // Registers a node's element, to move it
    function placeNode(el: SVGGElement, id: string) {
        let current = id;
        nodeEls.set(current, el);
        paintNode(current);
        return {
            update(next: string) {
                if (nodeEls.get(current) === el) nodeEls.delete(current);
                current = next;
                nodeEls.set(current, el);
                paintNode(current);
            },
            destroy() {
                if (nodeEls.get(current) === el) nodeEls.delete(current);
            },
        };
    }

    // Edges between the same two nodes curve apart, so each can be seen and clicked
    const bends = $derived.by(() => {
        const groups = new Map<string, E[]>();
        for (const e of graph.edges) {
            const key = e.from < e.to ? `${e.from}\u0000${e.to}` : `${e.to}\u0000${e.from}`;
            let list = groups.get(key);
            if (!list) groups.set(key, list = []);
            list.push(e);
        }
        const result = new Map<string, number>();
        for (const list of groups.values()) {
            if (list.length == 1) continue;
            // Bends are to the left of each edge's direction, so edges both ways separate anyway
            const counts = new Map<string, number>();
            for (const e of list) {
                const n = counts.get(e.from) ?? 0;
                counts.set(e.from, n + 1);
                result.set(e.id, 10 + n * 14);
            }
        }
        return result;
    });

    // Shows the whole graph
    export function fit(byViewer = true) {
        if (byViewer) autoFit = true;
        const bounds = boundsOf([...model.nodes.values()]);
        if (!bounds || !width || !height) return;
        transform = fitTransform(bounds, { width, height }, 24, 1.25);
    }

    export function zoomBy(factor: number) {
        autoFit = false;
        transform = zoomAt(transform, factor, { x: width / 2, y: height / 2 });
    }

    // Pans to bring a node into view, if it isn't. While the map's fitting the whole graph in
    // view, it already is.
    // Pans as little as it can to bring a node into view. `covered` is how much of the map's right
    // and bottom edges the host has put something over, such as a panel: a node under it isn't in
    // view.
    export function reveal(id: string, covered: { right?: number; bottom?: number } = {}) {
        const b = box(id);
        const right = covered.right ?? 0, bottom = covered.bottom ?? 0;
        // While the whole graph is fitted in view, only what's covered can be out of sight
        if (!b || !width || (autoFit && !right && !bottom)) return;
        const next = revealTransform(
            transform, { x: b.x - b.width / 2, y: b.y - b.height / 2, width: b.width, height: b.height },
            { width: Math.max(width - right, 100), height: Math.max(height - bottom, 100) },
        );
        if (next) {
            autoFit = false;
            transform = next;
        }
    }

    // Lays the graph out again from scratch, keeping only what's in `pins`
    export function relayout(pins: ReadonlyMap<string, Point> = new Map()) {
        model.relayout(pins);
        fast = true;
        autoFit = true;
        paint();
        wake();
    }

    // A node's id is changing (e.g. it was renamed): it keeps its place. Call before the graph
    // with the new id arrives.
    export function rename(from: string, to: string) {
        model.rename(from, to);
        if (selected == from) selected = to;
    }

    // Where a point on the screen (e.g. a pointer's clientX and clientY) is on the map
    export function mapPoint(clientX: number, clientY: number): Point {
        const rect = container!.getBoundingClientRect();
        return toMap(transform, { x: clientX - rect.left, y: clientY - rect.top });
    }

    // Where the middle of the view is on the map
    export function centre(): Point {
        return toMap(transform, { x: width / 2, y: height / 2 });
    }

    // The node whose centre is nearest a point on the map, of those the host accepts
    export function nearest(at: Point, accept: (node: N) => boolean = () => true): N | undefined {
        let best: N | undefined;
        let bestDistance = Infinity;
        for (const n of graph.nodes) {
            const p = model.position(n.id);
            if (!p || n.decoration || !accept(n)) continue;
            const distance = Math.hypot(p.x - at.x, p.y - at.y);
            if (distance < bestDistance) {
                best = n;
                bestDistance = distance;
            }
        }
        return best;
    }

    // Where a point on the map is in the window, e.g. to put something of the host's over it
    export function screenPoint(at: Point): Point {
        const rect = container!.getBoundingClientRect();
        return { x: rect.left + transform.x + at.x * transform.k, y: rect.top + transform.y + at.y * transform.k };
    }

    // The middle of a node, on the map
    export function positionOf(id: string): Point | undefined {
        return model.position(id);
    }

    // Takes the keyboard focus, e.g. after a menu closes
    export function focus() {
        container?.focus({ preventScroll: true });
    }

    // Whether a node has been laid out yet
    export function has(id: string) {
        return model.position(id) !== undefined;
    }

    $effect(() => {
        // Keep the fit as the map's pane is resized
        void width;
        void height;
        untrack(() => {
            if (autoFit) fit(false);
        });
    });

    // The node under a point on the map, if any
    function nodeAt(p: Point): N | undefined {
        for (let i = graph.nodes.length - 1; i >= 0; i--) {
            const n = graph.nodes[i];
            const at = model.position(n.id);
            if (at && Math.abs(p.x - at.x) <= n.width / 2 && Math.abs(p.y - at.y) <= n.height / 2) return n;
        }
        return undefined;
    }

    // ---- Pointer ----

    // Nodes selected together, with Shift+drag on the background (a lasso) or Shift+click, to move
    // them at once. The single `selected` node is separate: the one the host shows details of.
    let group = $state.raw<ReadonlySet<string>>(new Set());

    type Gesture =
        | { kind: "lasso"; start: Point; at: Point; base: ReadonlySet<string> }
        | { kind: "pan"; start: Point; from: Transform; moved: boolean }
        | { kind: "pinch"; distance: number; from: Transform; centre: Point }
        | { kind: "node"; id: string; start: Point; offset: Point; dragging: boolean }
        | { kind: "connect"; from: string; at: Point; target: string | null };

    let gesture = $state<Gesture | null>(null);
    // The last node pressed, and when, for double-clicks
    let lastNodeDown = { id: "", time: 0 };
    const pointers = new Map<number, Point>();

    const local = (e: PointerEvent | WheelEvent | MouseEvent): Point => {
        const rect = container!.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    function handlePointerDown(e: PointerEvent) {
        if (e.button != 0 && e.pointerType == "mouse") return;
        container?.focus({ preventScroll: true });
        const p = local(e);
        pointers.set(e.pointerId, p);
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        if (pointers.size == 2) {
            const [a, b] = [...pointers.values()];
            gesture = { kind: "pinch", distance: Math.hypot(a.x - b.x, a.y - b.y), from: transform, centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
            return;
        }
        const target = e.target as Element;
        const handle = target.closest("[data-handle]");
        const nodeEl = target.closest("[data-node]");
        if (handle) {
            const id = handle.getAttribute("data-handle")!;
            gesture = { kind: "connect", from: id, at: toMap(transform, p), target: null };
            e.stopPropagation();
            return;
        }
        if (nodeEl) {
            const id = nodeEl.getAttribute("data-node")!;
            lastNodeDown = { id, time: performance.now() };
            const at = model.position(id)!;
            const m = toMap(transform, p);
            gesture = { kind: "node", id, start: p, offset: { x: at.x - m.x, y: at.y - m.y }, dragging: false };
            return;
        }
        if (e.shiftKey) {
            const m = toMap(transform, p);
            gesture = { kind: "lasso", start: m, at: m, base: group };
            return;
        }
        gesture = { kind: "pan", start: p, from: transform, moved: false };
    }

    function handlePointerMove(e: PointerEvent) {
        if (!pointers.has(e.pointerId)) {
            if (!pointers.size && e.pointerType == "mouse") updateHover(e);
            return;
        }
        const p = local(e);
        pointers.set(e.pointerId, p);
        const g = gesture;
        if (!g) return;
        if (g.kind == "pinch") {
            if (pointers.size < 2) return;
            const [a, b] = [...pointers.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const zoomed = zoomAt(g.from, d / g.distance, g.centre);
            autoFit = false;
            transform = { ...zoomed, x: zoomed.x + c.x - g.centre.x, y: zoomed.y + c.y - g.centre.y };
        } else if (g.kind == "pan") {
            const dx = p.x - g.start.x, dy = p.y - g.start.y;
            if (!g.moved && Math.hypot(dx, dy) < 3) return;
            g.moved = true;
            autoFit = false;
            transform = { ...g.from, x: g.from.x + dx, y: g.from.y + dy };
        } else if (g.kind == "node") {
            if (!g.dragging) {
                if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < 4) return;
                g.dragging = true;
                autoFit = false;
                fast = false;
                // Dragging one of a group moves the whole group; anything else drops the group
                if (group.has(g.id) && group.size > 1) model.startDrag([...group]);
                else {
                    group = new Set();
                    model.startDrag(g.id);
                }
            }
            const m = toMap(transform, p);
            model.drag(g.id, { x: m.x + g.offset.x, y: m.y + g.offset.y });
            paint();
            wake();
        } else if (g.kind == "lasso") {
            gesture = { ...g, at: toMap(transform, p) };
        } else if (g.kind == "connect") {
            const m = toMap(transform, p);
            const over = nodeAt(m);
            const from = nodesById.get(g.from)!;
            const allowed = over && over.id != g.from && (canConnect?.(from, over) ?? true);
            gesture = { ...g, at: m, target: allowed ? over.id : null };
        }
    }

    function handlePointerUp(e: PointerEvent) {
        if (!pointers.delete(e.pointerId)) return;
        const g = gesture;
        if (g?.kind == "pinch") {
            // Carry on panning with the finger that's left
            const [rest] = [...pointers.values()];
            gesture = rest ? { kind: "pan", start: rest, from: transform, moved: true } : null;
            return;
        }
        gesture = null;
        if (!g || e.type == "pointercancel") {
            if (g?.kind == "node" && g.dragging) model.endDrag();
            return;
        }
        if (g.kind == "node") {
            const n = nodesById.get(g.id);
            if (g.dragging) {
                const dropped = model.endDrag();
                wake();
                const moves = [...dropped].flatMap(([id, at]) => {
                    const node = nodesById.get(id);
                    return node ? [{ node, at }] : [];
                });
                if (moves.length) onmove?.(moves);
            } else if (n && e.shiftKey) {
                // Shift+click adds a node to the group, or takes it out
                const next = new Set(group.size ? group : selected ? [selected] : []);
                if (next.has(n.id)) next.delete(n.id);
                else next.add(n.id);
                setGroup(next);
            } else if (n) {
                group = new Set();
                select(n.id, false);
                onactivate?.(n, "click");
            }
        } else if (g.kind == "lasso") {
            setGroup(new Set([...g.base, ...lassoed(g)]));
        } else if (g.kind == "connect") {
            const from = nodesById.get(g.from);
            const to = g.target ? nodesById.get(g.target) ?? null : null;
            const overSelf = nodeAt(g.at)?.id == g.from;
            if (from && !overSelf && (to || (canConnect?.(from, null) ?? true))) onconnect?.(from, to, g.at);
        } else if (g.kind == "pan" && !g.moved) {
            const edge = edgeAt(toMap(transform, local(e)));
            if (edge) onedgeactivate?.(edge);
            else {
                selected = null;
                group = new Set();
            }
        }
    }

    // The nodes a lasso touches
    function lassoed(g: { start: Point; at: Point }): string[] {
        const x0 = Math.min(g.start.x, g.at.x), x1 = Math.max(g.start.x, g.at.x);
        const y0 = Math.min(g.start.y, g.at.y), y1 = Math.max(g.start.y, g.at.y);
        return graph.nodes.filter(n => {
            const p = model.position(n.id);
            return p && !n.decoration
                && p.x + n.width / 2 >= x0 && p.x - n.width / 2 <= x1
                && p.y + n.height / 2 >= y0 && p.y - n.height / 2 <= y1;
        }).map(n => n.id);
    }

    // A group of one is just the selected node
    function setGroup(next: Set<string>) {
        if (next.size <= 1) {
            group = new Set();
            const [only] = next;
            select(only ?? null);
            return;
        }
        group = next;
        selected = null;
        announcement = `${next.size} selected. Drag one of them to move them all.`;
    }

    function handleDoubleClick(e: MouseEvent) {
        const at = toMap(transform, local(e));
        // The node the first click was on, if it's moved from under the pointer since: selecting
        // a node can change the host's layout (a panel about it appears, say), and the map with it
        const nodeEl = (e.target as Element).closest("[data-node]");
        const n = (nodeEl && nodesById.get(nodeEl.getAttribute("data-node")!))
            || (performance.now() - lastNodeDown.time < 700 ? nodesById.get(lastNodeDown.id) : undefined);
        if (n) {
            // The second click may have landed on the background, and let go of it
            selected = n.id;
            onactivate?.(n, "open");
            return;
        }
        if (edgeAt(at)) return;
        oncreate?.(at);
    }

    function handleContextMenu(e: MouseEvent) {
        if (!onmenu) return;
        e.preventDefault();
        const rect = container!.getBoundingClientRect();
        // From the menu key or Shift+F10 rather than a pointer: for the selected node, under it
        const keyboard = "pointerType" in e ? e.pointerType === "" : e.button != 2;
        if (keyboard) {
            const n = selected ? nodesById.get(selected) : undefined;
            const at = n && model.position(n.id);
            if (n && at) {
                onmenu(n, at, { x: rect.left + transform.x + at.x * transform.k, y: rect.top + transform.y + (at.y + n.height / 2) * transform.k }, true);
            } else {
                onmenu(null, centre(), { x: rect.left + width / 2, y: rect.top + height / 2 }, true);
            }
            return;
        }
        const nodeEl = (e.target as Element).closest("[data-node]");
        const n = nodeEl ? nodesById.get(nodeEl.getAttribute("data-node")!) : undefined;
        if (n) select(n.id);
        container?.focus({ preventScroll: true });
        onmenu(n ?? null, toMap(transform, local(e)), { x: e.clientX, y: e.clientY }, false);
    }

    // Scroll pans; pinch (which browsers send as Ctrl+scroll) or Ctrl/Cmd+scroll zooms
    function handleWheel(e: WheelEvent) {
        e.preventDefault();
        autoFit = false;
        if (e.ctrlKey || e.metaKey) {
            transform = zoomAt(transform, Math.exp(-e.deltaY * (e.deltaMode == 1 ? 0.05 : 0.002) * (e.ctrlKey && !e.metaKey ? 4 : 1)), local(e));
        } else {
            const scale = e.deltaMode == 1 ? 16 : 1;
            transform = { ...transform, x: transform.x - e.deltaX * scale, y: transform.y - e.deltaY * scale };
        }
    }

    $effect(() => {
        const el = container;
        if (!el) return;
        // Not passive, so the page doesn't scroll or zoom too
        el.addEventListener("wheel", handleWheel, { passive: false });
        return () => el.removeEventListener("wheel", handleWheel);
    });

    // ---- Keyboard ----

    // Selects a node, bringing it into view, and reads it out
    export function select(id: string | null, announce = true) {
        selected = id;
        if (!id) return;
        reveal(id);
        if (announce) announcement = nodesById.get(id)?.description ?? nodesById.get(id)?.label ?? "";
    }

    function handleKeydown(e: KeyboardEvent) {
        const directions: Record<string, "up" | "down" | "left" | "right"> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
        const direction = directions[e.key];
        const current = selected ? box(selected) : undefined;
        if (direction && !e.altKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            const candidates = graph.nodes.filter(n => !n.decoration).map(n => ({ ...box(n.id)!, id: n.id })).filter(b => b.x !== undefined);
            let next;
            if (!current) {
                // Start from the node nearest the middle of the view
                const c = centre();
                next = candidates.reduce<(typeof candidates)[number] | undefined>((best, b) => !best || Math.hypot(b.x - c.x, b.y - c.y) < Math.hypot(best.x - c.x, best.y - c.y) ? b : best, undefined);
            } else {
                next = nearestInDirection({ ...current }, candidates.filter(b => b.id != selected), direction);
            }
            if (next) select(next.id);
        } else if (e.key == "Enter" && selected) {
            e.preventDefault();
            const n = nodesById.get(selected);
            if (n) onactivate?.(n, "open");
        } else if (e.key == "F2" && selected) {
            e.preventDefault();
            const n = nodesById.get(selected);
            if (n) onrename?.(n);
        } else if ((e.key == "Delete" || e.key == "Backspace") && ondelete && !e.altKey && !e.ctrlKey && !e.metaKey) {
            // The nodes selected together, unless another's been selected since
            const ids = group.size && (!selected || group.has(selected)) ? [...group] : selected ? [selected] : [];
            const nodes = ids.map(id => nodesById.get(id)).filter(n => n !== undefined);
            if (!nodes.length) return;
            e.preventDefault();
            ondelete(nodes);
        } else if (e.key == "Escape" && (selected || group.size)) {
            e.preventDefault();
            selected = null;
            group = new Set();
        } else if ((e.key == "+" || e.key == "=") && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            zoomBy(1.25);
        } else if (e.key == "-" && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            zoomBy(0.8);
        } else if (e.key == "0" && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            fit();
        }
    }

    // The default drawing: the label, shortened to fit the box
    function shortLabel(n: N) {
        const fits = Math.max(1, Math.floor((n.width - 14) / 6.6));
        return n.label.length > fits ? `${n.label.slice(0, Math.max(1, fits - 1))}…` : n.label;
    }

    const instructionsId = `graph-map-${Math.random().toString(36).slice(2)}`;
    const lassoIds = $derived(gesture?.kind == "lasso" ? new Set(lassoed(gesture)) : new Set<string>());
    const connectFrom = $derived(gesture?.kind == "connect" ? box(gesture.from) : undefined);
</script>

<!-- An application role, so screen readers pass the arrow keys through. Svelte's checks don't
     count role="application" as interactive, but it is: this element is the control, with focus
     and its own keyboard handling, and the boxes are drawn inside it (#639) -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
    bind:this={container}
    bind:clientWidth={width}
    bind:clientHeight={height}
    class="graph-map"
    class:graph-map-connecting={gesture?.kind == "connect" || gesture?.kind == "lasso"}
    class:graph-map-panning={gesture?.kind == "pan" && gesture.moved}
    class:graph-map-over-edge={hovered !== null && !gesture}
    role="application"
    aria-roledescription="map"
    aria-label={label}
    aria-describedby={instructions ? instructionsId : undefined}
    tabindex="0"
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerUp}
    ondblclick={handleDoubleClick}
    oncontextmenu={handleContextMenu}
    onkeydown={handleKeydown}
    onpointerleave={() => { hovered = null; }}
>
    <canvas bind:this={canvas} class="gm-canvas" style:width="{width}px" style:height="{height}px" aria-hidden="true"></canvas>
    <svg {width} {height} aria-hidden="true">
        <!-- The hovered edge's tooltip -->
        <title>{hoveredEdge?.title ?? ""}</title>
        <!-- Where edgeStyle looks up edges' styles -->
        <g class="gm-edges" bind:this={probes} style:display="none"></g>
        <g transform="translate({transform.x},{transform.y}) scale({transform.k})">
            <g class="gm-nodes">
                {#each graph.nodes as n (n.id)}
                    {@const state = { selected: n.id == selected, target: gesture?.kind == "connect" && gesture.target == n.id, dragging: gesture?.kind == "node" && gesture.dragging && gesture.id == n.id }}
                    <g
                        class="gm-node {n.class ?? ""}"
                        class:gm-node-selected={state.selected || group.has(n.id) || (gesture?.kind == "lasso" && lassoIds.has(n.id))}
                        class:gm-node-target={state.target}
                        class:gm-node-dragging={state.dragging}
                        data-node={n.id}
                        use:placeNode={n.id}
                    >
                        <title>{n.title ?? n.label}</title>
                        {#if drawNode}
                            {@render drawNode(n, state)}
                        {:else}
                            <rect class="gm-node-box" width={n.width} height={n.height} rx="6" />
                            <text class="gm-node-label" x={n.width / 2} y={n.height / 2} dy="0.35em" text-anchor="middle">{shortLabel(n)}</text>
                        {/if}
                        {#if onconnect && !n.decoration && (state.selected || gesture?.kind == "connect" && gesture.from == n.id)}
                            <g class="gm-handle" data-handle={n.id} transform="translate({n.width / 2},{n.height})">
                                <title>Drag to link</title>
                                <circle r="9" class="gm-handle-hit" />
                                <circle r="5" class="gm-handle-dot" />
                            </g>
                        {/if}
                    </g>
                {/each}
            </g>
            {#if gesture?.kind == "lasso"}
                <rect
                    class="gm-lasso"
                    x={Math.min(gesture.start.x, gesture.at.x)}
                    y={Math.min(gesture.start.y, gesture.at.y)}
                    width={Math.abs(gesture.at.x - gesture.start.x)}
                    height={Math.abs(gesture.at.y - gesture.start.y)}
                />
            {/if}
            {#if gesture?.kind == "connect" && connectFrom}
                {@const to = gesture.target ? box(gesture.target) : undefined}
                {@const shape = edgeShape(connectFrom, to ?? { ...gesture.at, width: 0, height: 0 }, 0, 3)}
                {#if shape}
                    <g class="gm-connecting">
                        <path class="gm-edge-line" d={shape.d} />
                        <path class="gm-edge-arrow" d={arrowhead(shape.tip, shape.angle)} />
                    </g>
                {/if}
            {/if}
        </g>
    </svg>
    {#if instructions}
        <p id={instructionsId} class="gm-sr-only">{instructions}</p>
    {/if}
    <p class="gm-sr-only" aria-live="polite">{announcement}</p>
</div>

<style>
    .graph-map {
        /* Colours, which the host can set. light-dark() follows the page's color-scheme. */
        --gm-background: light-dark(#f8f9fb, #15171c);
        --gm-node-fill: light-dark(#ffffff, #23262e);
        --gm-node-stroke: light-dark(#9aa1ad, #5d6573);
        --gm-node-text: light-dark(#1f2329, #e6e8ec);
        --gm-edge: light-dark(#8a919d, #7b8391);
        --gm-accent: light-dark(#2563eb, #60a5fa);
        --gm-font: system-ui, sans-serif;

        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: var(--gm-background);
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
        outline: none;
        cursor: grab;
    }
    .graph-map:focus-visible {
        box-shadow: inset 0 0 0 2px var(--gm-accent);
    }
    .graph-map-panning {
        cursor: grabbing;
    }
    .graph-map-connecting {
        cursor: crosshair;
    }
    .graph-map-over-edge {
        cursor: pointer;
    }
    /* The edges, under the nodes */
    .gm-canvas {
        position: absolute;
        top: 0;
        left: 0;
        pointer-events: none;
    }
    svg {
        position: relative;
        display: block;
        font-family: var(--gm-font);
    }
    .gm-node {
        cursor: pointer;
    }
    .gm-node-dragging {
        cursor: grabbing;
    }
    :global(.gm-node-box) {
        fill: var(--gm-node-fill);
        stroke: var(--gm-node-stroke);
        stroke-width: 1;
    }
    :global(.gm-node-label) {
        fill: var(--gm-node-text);
        font-size: 12px;
    }
    .gm-node-selected :global(.gm-node-box) {
        stroke: var(--gm-accent);
        stroke-width: 2.5;
    }
    .gm-node-target :global(.gm-node-box) {
        stroke: var(--gm-accent);
        stroke-width: 2.5;
        stroke-dasharray: 4 2;
    }
    /* Edges are drawn on the canvas, with these styles (and the host's) as edgeStyle finds them
       on hidden elements: <g class="gm-edge"> with gm-edge-selected or gm-edge-hover, and
       data-long when the edge is long, around a .gm-edge-line and a .gm-edge-arrow. */
    :global(.gm-edge[data-long]) {
        opacity: 0.3;
    }
    :global(.gm-edge-hover[data-long]),
    :global(.gm-edge-selected[data-long]) {
        opacity: 1;
    }
    :global(.gm-edge-line) {
        fill: none;
        stroke: var(--gm-edge);
        stroke-width: 1.3;
    }
    :global(.gm-edge-arrow) {
        fill: var(--gm-edge);
        stroke: none;
    }
    /* At least as specific as these were on SVG elements (.gm-edge.svelte-hash:hover), so they
       still win over the host's styles for kinds of edge */
    .graph-map :global(.gm-edge.gm-edge-hover .gm-edge-line),
    .graph-map :global(.gm-edge.gm-edge-selected .gm-edge-line) {
        stroke: var(--gm-accent);
        stroke-width: 2;
    }
    .graph-map :global(.gm-edge.gm-edge-hover .gm-edge-arrow),
    .graph-map :global(.gm-edge.gm-edge-selected .gm-edge-arrow) {
        fill: var(--gm-accent);
    }
    .gm-connecting :global(.gm-edge-line) {
        stroke: var(--gm-accent);
        stroke-width: 2;
        stroke-dasharray: 5 3;
    }
    .gm-connecting :global(.gm-edge-arrow) {
        fill: var(--gm-accent);
    }
    .gm-lasso {
        fill: color-mix(in srgb, var(--gm-accent) 10%, transparent);
        stroke: var(--gm-accent);
        stroke-dasharray: 4 3;
        vector-effect: non-scaling-stroke;
    }
    .gm-handle {
        cursor: crosshair;
    }
    .gm-handle-hit {
        fill: transparent;
    }
    .gm-handle-dot {
        fill: var(--gm-accent);
        stroke: var(--gm-node-fill);
        stroke-width: 1.5;
    }
    .gm-sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
    }
</style>
