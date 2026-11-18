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
        arrowhead, boundsOf, edgeShape, fitTransform, identity, MapModel, nearestInDirection, revealTransform,
        toMap, zoomAt, type Transform,
    } from "@textadventures/graph-map";


    const NONE: ReadonlyMap<string, Point> = new Map();

    let {
        graph, layout, pinned = NONE, selected = $bindable(null), longEdge = 400, label, instructions, node: drawNode, canConnect,
        onactivate, onedgeactivate, onmove, onconnect, oncreate, onrename,
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

    onMount(() => () => cancelAnimationFrame(raf));

    // Runs the simulation while it's moving
    function wake() {
        if (raf || typeof requestAnimationFrame == "undefined") return;
        raf = requestAnimationFrame(loop);
    }

    function loop() {
        raf = 0;
        const moved = model.step(fast ? 12 : 4, fast ? Infinity : 1);
        if (model.settled) fast = false;
        if (moved) {
            paint();
            if (autoFit) fit(false);
        }
        if (!model.settled) raf = requestAnimationFrame(loop);
    }

    // ---- The view ----

    // Positions are written straight to the nodes' and edges' elements on each frame, rather than
    // through Svelte, which would check every node and edge in the template each time: too slow
    // for a story with hundreds of sections while it's moving.
    const nodeEls = new Map<string, SVGGElement>();
    const edgeEls = new Map<string, { group: SVGGElement; paths: SVGPathElement[]; arrow: SVGPathElement }>();

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

    function paintEdge(e: E) {
        const els = edgeEls.get(e.id);
        if (!els) return;
        const path = edgePath(e);
        els.group.style.display = path ? "" : "none";
        if (!path) return;
        for (const el of els.paths) el.setAttribute("d", path.d);
        els.arrow.setAttribute("d", path.arrow);
        // An attribute rather than a class, which Svelte would overwrite when the edge's class changes
        const a = model.position(e.from), b = model.position(e.to);
        els.group.toggleAttribute("data-long", !!a && !!b && Math.hypot(b.x - a.x, b.y - a.y) > longEdge);
    }

    function paint() {
        for (const n of graph.nodes) paintNode(n.id);
        for (const e of graph.edges) paintEdge(e);
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

    function placeEdge(el: SVGGElement, edge: E) {
        let current = edge;
        const register = () => edgeEls.set(current.id, {
            group: el,
            paths: [...el.querySelectorAll<SVGPathElement>(".gm-edge-hit, .gm-edge-line")],
            arrow: el.querySelector<SVGPathElement>(".gm-edge-arrow")!,
        });
        register();
        paintEdge(current);
        return {
            update(next: E) {
                if (edgeEls.get(current.id)?.group === el) edgeEls.delete(current.id);
                current = next;
                register();
                paintEdge(current);
            },
            destroy() {
                if (edgeEls.get(current.id)?.group === el) edgeEls.delete(current.id);
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

    function edgePath(e: E) {
        const a = box(e.from), b = box(e.to);
        if (!a || !b) return undefined;
        const shape = edgeShape(a, b, bends.get(e.id) ?? 0, 3);
        return shape && { d: shape.d, arrow: arrowhead(shape.tip, shape.angle) };
    }

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
    export function reveal(id: string) {
        const b = box(id);
        if (!b || !width || autoFit) return;
        const next = revealTransform(transform, { x: b.x - b.width / 2, y: b.y - b.height / 2, width: b.width, height: b.height }, { width, height });
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
        if (!pointers.has(e.pointerId)) return;
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
            const edgeEl = (e.target as Element).closest("[data-edge]");
            const edge = edgeEl && graph.edges.find(x => x.id == edgeEl.getAttribute("data-edge"));
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
        const nodeEl = (e.target as Element).closest("[data-node]");
        const n = nodeEl && nodesById.get(nodeEl.getAttribute("data-node")!);
        if (n) {
            onactivate?.(n, "open");
            return;
        }
        if ((e.target as Element).closest("[data-edge]")) return;
        oncreate?.(toMap(transform, local(e)));
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

<!-- An application role, so screen readers pass the arrow keys through -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
    bind:this={container}
    bind:clientWidth={width}
    bind:clientHeight={height}
    class="graph-map"
    class:graph-map-connecting={gesture?.kind == "connect" || gesture?.kind == "lasso"}
    class:graph-map-panning={gesture?.kind == "pan" && gesture.moved}
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
    onkeydown={handleKeydown}
>
    <svg {width} {height} aria-hidden="true">
        <g transform="translate({transform.x},{transform.y}) scale({transform.k})">
            <g class="gm-edges">
                {#each graph.edges as edge (edge.id)}
                    <g class="gm-edge {edge.class ?? ""}" class:gm-edge-selected={edge.from == selected || edge.to == selected} data-edge={edge.id} use:placeEdge={edge}>
                        <title>{edge.title ?? ""}</title>
                        <path class="gm-edge-hit" />
                        <path class="gm-edge-line" />
                        <path class="gm-edge-arrow" />
                    </g>
                {/each}
            </g>
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
                        <title>{n.label}</title>
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
    svg {
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
    .gm-edge {
        cursor: pointer;
    }
    /* data-long is set as the edges are drawn, which Svelte can't see */
    .gm-edge:global([data-long]) {
        opacity: 0.3;
    }
    .gm-edge:global([data-long]):hover,
    .gm-edge-selected:global([data-long]) {
        opacity: 1;
    }
    .gm-edge-hit {
        fill: none;
        stroke: transparent;
        stroke-width: 10;
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
    .gm-edge:hover :global(.gm-edge-line),
    .gm-edge-selected :global(.gm-edge-line) {
        stroke: var(--gm-accent);
        stroke-width: 2;
    }
    .gm-edge:hover :global(.gm-edge-arrow),
    .gm-edge-selected :global(.gm-edge-arrow) {
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
