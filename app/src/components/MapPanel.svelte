<script lang="ts" module>
    // A place the player went to in the preview
    export interface TraceStep {
        section: string;
        passage?: string;
    }

    // A label, shortened to fit its box, leaving room for a marker
    function fit(n: { label: string; width: number }, reserve: number) {
        const chars = Math.max(1, Math.floor((n.width - 14 - reserve) / 6.6));
        return n.label.length > chars ? `${n.label.slice(0, Math.max(1, chars - 1))}…` : n.label;
    }
</script>

<script lang="ts">
    // The story map (#380): the story's sections as boxes, their passages hanging under them, and
    // links as arrows, drawn from the language service's story graph by @textadventures/graph-map.
    // The text is the source of truth: the map is a view of it, and editing on the map edits the
    // text. Clicking a node moves the editor there; the editor's cursor highlights its section here.
    // Problems (broken links, sections that can't be reached, dead ends) show on the map, and so
    // does the path the player took in the preview.
    import type { GraphNode, StoryGraph } from "squiffy-compiler/language-service";
    import type { MapPositions } from "squiffy-compiler";
    import GraphMap from "@textadventures/graph-map/GraphMap.svelte";
    import type { NodeState } from "@textadventures/graph-map/GraphMap.svelte";
    import { buildStoryMap, linkTo, pinnedPositions, storyMapLayout, type Point, type StoryMapEdge, type StoryMapNode } from "#lib/story-map.js";
    import ZoomIn from "@lucide/svelte/icons/zoom-in";
    import ZoomOut from "@lucide/svelte/icons/zoom-out";
    import Scan from "@lucide/svelte/icons/scan";
    import Maximize2 from "@lucide/svelte/icons/maximize-2";
    import Minimize2 from "@lucide/svelte/icons/minimize-2";
    import RefreshCcw from "@lucide/svelte/icons/refresh-ccw";
    import CircleHelp from "@lucide/svelte/icons/circle-help";
    import Plus from "@lucide/svelte/icons/plus";
    import X from "@lucide/svelte/icons/x";
    import Pencil from "@lucide/svelte/icons/pencil";
    import Play from "@lucide/svelte/icons/play";
    import Code from "@lucide/svelte/icons/code";

    interface Props {
        graph: StoryGraph | null;
        // Positions the author has chosen, from squiffy.json
        positions: MapPositions | undefined;
        // The outline's search: nodes that don't match fade
        query: string;
        // The section or passage the editor's cursor is in
        current: string | null;
        // Where the player has been in the preview, in order
        trace: TraceStep[];
        maximized: boolean;
        width?: number;
        // Go to a node (or a broken link) in the editor, taking the focus or not
        ongoto: (node: StoryMapNode, focus: boolean) => void;
        ongotoedge: (edge: StoryMapEdge) => void;
        // Sections and passages were dropped somewhere (several, if they were dragged together)
        onmove: (moves: { node: GraphNode; at: Point }[]) => void;
        // Add a link from one node to another, or to a new section
        onlink: (from: GraphNode, to: GraphNode | null, at: Point) => void;
        oncreate: (at: Point, near: GraphNode | undefined) => void;
        onrename: (node: GraphNode) => void;
        onrun: (node: GraphNode) => void;
        // Forget every position the author chose
        onrelayout: () => Promise<boolean>;
        ontogglemaximized: () => void;
        onclose: () => void;
    }

    let {
        graph, positions, query, current, trace, maximized, width, ongoto, ongotoedge, onmove, onlink, oncreate, onrename,
        onrun, onrelayout, ontogglemaximized, onclose,
    }: Props = $props();

    // Above this, the map is slow to lay out, so it asks first. Of about 12,000 stories on
    // textadventures.co.uk, only two generated test stories are this big. A story of 4,000
    // sections and passages with 50,000 links settles in about 12 seconds, at 30 frames a second.
    const LARGE = 6000;

    let map = $state<ReturnType<typeof GraphMap<StoryMapNode, StoryMapEdge>>>();
    let selected = $state<string | null>(null);
    let showLarge = $state(false);
    let keyOpen = $state(false);
    const layout = storyMapLayout();

    const base = $derived(graph ? buildStoryMap(graph) : null);
    const pinned = $derived(pinnedPositions(positions, graph));
    const tooLarge = $derived(!!base && base.nodes.length > LARGE && !showLarge);

    // Where the player went, and the links they took between those places
    const traced = $derived.by(() => {
        const visited = new Set<string>();
        const taken = new Set<string>();
        if (!base || !trace.length) return { visited, taken };
        const idOf = (step: TraceStep) => step.passage === undefined ? `section:${step.section}` : `passage:${step.section}/${step.passage}`;
        // Edges by where they go, with the section they come from
        const sectionOf = new Map(base.nodes.map(n => [n.id, n.section]));
        const into = new Map<string, { id: string; fromSection: string | undefined }[]>();
        for (const edge of base.edges) {
            let list = into.get(edge.to);
            if (!list) into.set(edge.to, list = []);
            list.push({ id: edge.id, fromSection: sectionOf.get(edge.from) });
        }
        for (let i = 0; i < trace.length; i++) {
            const id = idOf(trace[i]);
            visited.add(id);
            if (trace[i].passage !== undefined) visited.add(`section:${trace[i].section}`);
            if (i == 0) continue;
            const before = trace[i - 1].section;
            for (const edge of into.get(id) ?? []) {
                if (edge.fromSection == before) taken.add(edge.id);
            }
        }
        return { visited, taken };
    });

    // The map's graph, with the cursor, the search and the trace as classes
    const decorated = $derived.by(() => {
        if (!base) return null;
        const q = query.trim().toLowerCase();
        const matches = (n: StoryMapNode) => !q || n.label.toLowerCase().includes(q) || n.section.toLowerCase().includes(q);
        const hidden = new Set(base.nodes.filter(n => !matches(n)).map(n => n.id));
        const nodes = base.nodes.map(n => {
            const extra = [
                n.id == current ? "current" : "",
                traced.visited.has(n.id) ? "visited" : "",
                hidden.has(n.id) ? "filtered-out" : "",
            ].filter(Boolean);
            return extra.length ? { ...n, class: `${n.class} ${extra.join(" ")}` } : n;
        });
        const edges = base.edges.map(e => {
            const extra = [
                traced.taken.has(e.id) ? "trace" : "",
                hidden.has(e.from) || hidden.has(e.to) ? "filtered-out" : "",
            ].filter(Boolean);
            return extra.length ? { ...e, class: `${e.class} ${extra.join(" ")}` } : e;
        });
        return { nodes, edges };
    });

    const selectedNode = $derived(selected && base ? base.nodes.find(n => n.id == selected) : undefined);
    const links = $derived.by(() => {
        if (!base || !selectedNode) return { out: [], into: [] };
        const byId = new Map(base.nodes.map(n => [n.id, n]));
        const unique = (list: StoryMapNode[]) => [...new Map(list.map(n => [n.id, n])).values()];
        return {
            out: unique(base.edges.filter(e => e.from == selectedNode.id && e.kind != "auto").map(e => byId.get(e.to)!)),
            into: unique(base.edges.filter(e => e.to == selectedNode.id && e.kind != "auto").map(e => byId.get(e.from)!)),
        };
    });

    // The editor's cursor brings its section into view
    let lastCurrent: string | null = null;
    $effect(() => {
        const id = current;
        if (id == lastCurrent) return;
        lastCurrent = id;
        if (id && map?.has(id)) map.reveal(id);
    });

    // A node's id is changing (it's been renamed), so it keeps its place
    // Moves places from one id to another, e.g. after renames. The ids can swap or shift along,
    // so they go through temporary ids first.
    export function rename(pairs: [string, string][]) {
        for (const [from, to] of pairs) map?.rename(from, `\u0000${to}`);
        for (const [, to] of pairs) map?.rename(`\u0000${to}`, to);
    }

    export function relayout() {
        map?.relayout(new Map());
    }

    export function focusNode(id: string) {
        map?.select(id);
    }

    function canConnect(from: StoryMapNode, to: StoryMapNode | null) {
        if (!from.graphNode) return false;
        if (!to) return true;
        return !!to.graphNode && "text" in linkTo(from.graphNode, to.graphNode);
    }

    function handleActivate(node: StoryMapNode, how: "click" | "open") {
        if (node.kind == "missing") {
            ongotoedge({ id: "", from: "", to: node.id, kind: node.brokenEdge!.kind, edges: [node.brokenEdge!], conditional: false });
            return;
        }
        // Full-screen, a click just selects: the editor's out of sight
        if (how == "click" && maximized) return;
        ongoto(node, how == "open");
    }

    async function handleRelayout() {
        if (await onrelayout()) map?.relayout(new Map());
    }

    const instructions = "Arrow keys move between sections and passages. Enter goes to one in the editor, and F2 renames it. Plus and minus zoom, and 0 fits the whole story in view. Drag the background to pan, a box to move it, or the dot under the selected box to add a link. Shift and drag the background to select several boxes, or Shift and click one, then drag one of them to move them all.";
</script>

<section
    aria-label="Story map"
    class="story-map flex flex-col overflow-hidden border-l border-surface-200-800 bg-surface-50-950 {width === undefined ? "flex-1 min-w-0" : "shrink-0"}"
    style={width === undefined ? undefined : `width: ${width}px`}
>
    <header class="flex items-center gap-0.5 px-2 py-1 border-b border-surface-200-800">
        <h2 class="text-[11px] font-semibold text-surface-600-400 uppercase tracking-wide flex-1 pl-1">Map</h2>
        <button type="button" class="btn-icon btn-icon-sm" title="Add a section" aria-label="Add a section" onclick={() => oncreate(map?.centre() ?? { x: 0, y: 0 }, selectedNode?.graphNode)}><Plus size={14} /></button>
        <button type="button" class="btn-icon btn-icon-sm" title="Zoom in (+)" aria-label="Zoom in" onclick={() => map?.zoomBy(1.25)}><ZoomIn size={14} /></button>
        <button type="button" class="btn-icon btn-icon-sm" title="Zoom out (-)" aria-label="Zoom out" onclick={() => map?.zoomBy(0.8)}><ZoomOut size={14} /></button>
        <button type="button" class="btn-icon btn-icon-sm" title="Show the whole story (0)" aria-label="Show the whole story" onclick={() => map?.fit()}><Scan size={14} /></button>
        <button type="button" class="btn-icon btn-icon-sm" title="Lay out again" aria-label="Lay out again" onclick={handleRelayout}><RefreshCcw size={14} /></button>
        <button type="button" class="btn-icon btn-icon-sm" title="Key" aria-label="Key" aria-expanded={keyOpen} onclick={() => { keyOpen = !keyOpen; }}><CircleHelp size={14} /></button>
        <button
            type="button"
            class="btn-icon btn-icon-sm"
            title={maximized ? "Show the editor" : "Full screen"}
            aria-label={maximized ? "Show the editor" : "Full screen"}
            aria-pressed={maximized}
            onclick={ontogglemaximized}
        >{#if maximized}<Minimize2 size={14} />{:else}<Maximize2 size={14} />{/if}</button>
        <button type="button" class="btn-icon btn-icon-sm" title="Close map" aria-label="Close map" onclick={onclose}><X size={14} /></button>
    </header>
    {#if keyOpen}
        <div class="map-key border-b border-surface-200-800 px-3 py-2 text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 items-center">
            <svg width="36" height="10" aria-hidden="true"><line x1="0" y1="5" x2="36" y2="5" class="gm-edge-line edge-section-link" /></svg><span>Link to a section</span>
            <svg width="36" height="10" aria-hidden="true"><line x1="0" y1="5" x2="36" y2="5" class="gm-edge-line edge-passage-link" /></svg><span>Link to a passage</span>
            <svg width="36" height="10" aria-hidden="true"><line x1="0" y1="5" x2="36" y2="5" class="gm-edge-line edge-embed" /></svg><span>Embed</span>
            <svg width="36" height="10" aria-hidden="true"><line x1="0" y1="5" x2="36" y2="5" class="gm-edge-line edge-script" /></svg><span>{"{{goto}}"}, or squiffy.story.go in JavaScript</span>
            <svg width="36" height="10" aria-hidden="true"><line x1="0" y1="5" x2="36" y2="5" class="gm-edge-line edge-auto" /></svg><span>A passage that runs on its own, such as @last</span>
            <svg width="36" height="10" aria-hidden="true"><line x1="0" y1="5" x2="36" y2="5" class="gm-edge-line edge-section-link conditional" /></svg><span>Inside {"{{#if}}"} or {"{{#unless}}"}</span>
            <svg width="36" height="10" aria-hidden="true"><line x1="0" y1="5" x2="36" y2="5" class="gm-edge-line edge-section-link broken" /></svg><span>Broken link, to something that doesn't exist</span>
            <svg width="36" height="10" aria-hidden="true"><line x1="0" y1="5" x2="36" y2="5" class="gm-edge-line edge-section-link trace" /></svg><span>The way the player went in the preview</span>
            <span class="key-badge key-start">▶</span><span>The start</span>
            <span class="key-badge key-ending">■</span><span>An ending (@end)</span>
            <span class="key-badge key-dead-end">!</span><span>A dead end: no way out, and not an ending</span>
            <span class="key-badge key-unreachable"></span><span>Can't be reached from the start</span>
            <span></span><span class="text-surface-600-400 pt-1">Drag the dot under the selected box to another to add a link, or to empty space for a new section. Double-click empty space to add a section. Shift+drag empty space, or Shift+click, to select several boxes and move them together.</span>
        </div>
    {/if}
    <div class="relative flex-1 min-h-0">
        {#if !decorated}
            <p class="p-4 text-sm text-surface-600-400">Reading the story…</p>
        {:else if tooLarge}
            <div class="p-4 text-sm space-y-2">
                <p>This story has {base!.nodes.length.toLocaleString()} sections and passages, which is a lot to show on a map. It may be slow.</p>
                <button type="button" class="btn btn-sm preset-outlined-primary-500" onclick={() => { showLarge = true; }}>Show it anyway</button>
            </div>
        {:else}
            <GraphMap
                bind:this={map}
                bind:selected
                graph={decorated}
                {layout}
                {pinned}
                label="Story map"
                {instructions}
                {canConnect}
                onactivate={handleActivate}
                onedgeactivate={ongotoedge}
                onmove={moves => onmove(moves.flatMap(({ node, at }) => node.graphNode ? [{ node: node.graphNode, at }] : []))}
                onconnect={(from, to, at) => { if (from.graphNode) onlink(from.graphNode, to?.graphNode ?? null, at); }}
                oncreate={at => oncreate(at, selectedNode?.graphNode)}
                onrename={n => { if (n.graphNode && !n.graphNode.detail) onrename(n.graphNode); }}
                node={drawNode}
            />
            {#if decorated.nodes.length === 0}
                <p class="absolute inset-0 p-4 text-sm text-surface-600-400 pointer-events-none">No sections yet.</p>
            {/if}
        {/if}
    </div>
    {#if selectedNode?.graphNode}
        {@const g = selectedNode.graphNode}
        <div class="border-t border-surface-200-800 px-3 py-2 text-xs space-y-1">
            <div class="flex items-center gap-1">
                <span class="font-semibold truncate flex-1" title={selectedNode.label}>
                    {selectedNode.kind === "section" ? "Section" : "Passage"}: {selectedNode.label}
                </span>
                <button type="button" class="btn-icon btn-icon-sm" title="Go to it in the editor (Enter)" aria-label="Go to it in the editor" onclick={() => ongoto(selectedNode, true)}><Code size={13} /></button>
                {#if !g.detail}
                    <button type="button" class="btn-icon btn-icon-sm" title="Rename (F2)" aria-label="Rename" onclick={() => onrename(g)}><Pencil size={13} /></button>
                {/if}
                <button type="button" class="btn-icon btn-icon-sm" title="Run from here" aria-label="Run from here" onclick={() => onrun(g)}><Play size={13} /></button>
            </div>
            {#if g.start || g.ending || (g.deadEnd && g.reachable) || !g.reachable}
                <p class="text-surface-600-400">
                    {[g.start ? "The story starts here." : "", g.ending ? "An ending." : "", g.deadEnd && g.reachable ? "A dead end: there's no way out. If it's an ending, add @end." : "", g.embedded ? "Shown inside other sections, with {{embed}} or {{live}}." : !g.reachable ? "Can't be reached from the start." : ""].filter(Boolean).join(" ")}
                </p>
            {/if}
            {#if links.out.length}
                <p class="flex flex-wrap gap-1 items-baseline"><span class="text-surface-600-400">Links to</span>
                    {#each links.out as n (n.id)}<button type="button" class="link-chip" class:link-chip-missing={n.kind === "missing"} onclick={() => n.kind === "missing" ? handleActivate(n, "open") : map?.select(n.id)}>{n.label}</button>{/each}
                </p>
            {/if}
            {#if links.into.length}
                <p class="flex flex-wrap gap-1 items-baseline"><span class="text-surface-600-400">Linked from</span>
                    {#each links.into as n (n.id)}<button type="button" class="link-chip" onclick={() => map?.select(n.id)}>{n.label}</button>{/each}
                </p>
            {/if}
        </div>
    {/if}
</section>

{#snippet drawNode(n: StoryMapNode, state: NodeState)}
    {@const g = n.graphNode}
    <rect class="gm-node-box" width={n.width} height={n.height} rx={n.kind === "section" ? 6 : n.height / 2} />
    {#if g?.ending}
        <rect class="ending-inner" x="2.5" y="2.5" width={n.width - 5} height={n.height - 5} rx="4" />
    {/if}
    <text class="gm-node-label" x={n.width / 2 + (g?.start ? 5 : 0)} y={n.height / 2} dy="0.35em" text-anchor="middle">{fit(n, g?.start ? 10 : 0)}</text>
    {#if g?.start}
        <path class="start-marker" d="M7,{n.height / 2 - 5}l8,5l-8,5z" />
    {/if}
    {#if (g?.deadEnd && g.reachable) || n.kind === "missing" || g?.unknownExits}
        <g transform="translate({n.width - 2},2)">
            <circle r="7" class={g?.unknownExits ? "badge-unknown" : "badge-problem"} />
            <text class="badge-text" dy="0.35em" text-anchor="middle">{g?.unknownExits ? "?" : "!"}</text>
        </g>
    {/if}
    {#if state.selected}
        <rect class="selected-ring" x="-3" y="-3" width={n.width + 6} height={n.height + 6} rx={n.kind === "section" ? 8 : n.height / 2 + 3} />
    {/if}
{/snippet}


<style>
    .story-map :global(.graph-map) {
        --gm-background: var(--color-surface-50-950);
        --gm-node-fill: light-dark(white, var(--color-surface-800));
        --gm-node-stroke: var(--color-surface-400-600);
        --gm-node-text: var(--color-surface-950-50);
        --gm-edge: var(--color-surface-500);
        --gm-accent: var(--color-primary-500);
        --gm-font: inherit;
    }

    /* Sections and passages */
    .story-map :global(.gm-node.passage .gm-node-box) {
        fill: light-dark(var(--color-surface-100), var(--color-surface-900));
    }
    .story-map :global(.gm-node.passage .gm-node-label),
    .story-map :global(.gm-node.missing .gm-node-label) {
        font-size: 11px;
    }
    .story-map :global(.gm-node.unnamed .gm-node-label) {
        font-style: italic;
    }
    .story-map :global(.gm-node.start .gm-node-box) {
        stroke: var(--color-primary-500);
        stroke-width: 1.5;
    }
    .story-map :global(.start-marker) {
        fill: var(--color-primary-500);
    }
    .story-map :global(.ending-inner) {
        fill: none;
        stroke: var(--color-surface-400-600);
    }
    .story-map :global(.gm-node.dead-end .gm-node-box) {
        stroke: var(--color-warning-500);
        stroke-width: 1.5;
    }
    .story-map :global(.badge-problem) {
        fill: var(--color-warning-500);
    }
    .story-map :global(.badge-unknown) {
        fill: var(--color-surface-500);
    }
    .story-map :global(.badge-text) {
        fill: white;
        font-size: 10px;
        font-weight: 700;
    }
    .story-map :global(.gm-node.unreachable) {
        opacity: 0.5;
    }
    .story-map :global(.gm-node.unreachable .gm-node-box) {
        stroke-dasharray: 4 3;
    }
    .story-map :global(.gm-node.missing .gm-node-box) {
        fill: light-dark(var(--color-error-50), var(--color-error-950));
        stroke: var(--color-error-500);
        stroke-dasharray: 3 2;
    }
    .story-map :global(.gm-node.missing .gm-node-label) {
        fill: var(--color-error-700-300);
    }
    .story-map :global(.missing .badge-problem) {
        fill: var(--color-error-500);
    }
    .story-map :global(.gm-node.current .gm-node-box) {
        fill: light-dark(var(--color-primary-100), var(--color-primary-900));
        stroke: var(--color-primary-500);
    }
    .story-map :global(.gm-node.visited .gm-node-box) {
        stroke: var(--color-success-500);
        stroke-width: 2;
    }
    .story-map :global(.selected-ring) {
        fill: none;
        stroke: var(--color-primary-500);
        stroke-width: 2;
    }
    .story-map :global(.gm-node.filtered-out),
    .story-map :global(.gm-edge.filtered-out) {
        opacity: 0.15;
    }

    /* Links, by kind */
    .story-map :global(.edge-passage-link.gm-edge-line),
    .story-map :global(.edge-passage-link .gm-edge-line) {
        stroke-width: 1;
        stroke: var(--color-surface-400-600);
    }
    .story-map :global(.edge-passage-link .gm-edge-arrow) {
        fill: var(--color-surface-400-600);
    }
    .story-map :global(.edge-embed.gm-edge-line),
    .story-map :global(.edge-embed .gm-edge-line) {
        stroke: var(--color-tertiary-500);
        stroke-dasharray: 1 3;
        stroke-linecap: round;
        stroke-width: 1.8;
    }
    .story-map :global(.edge-embed .gm-edge-arrow) {
        fill: var(--color-tertiary-500);
    }
    .story-map :global(.edge-script.gm-edge-line),
    .story-map :global(.edge-script .gm-edge-line),
    .story-map :global(.edge-goto.gm-edge-line),
    .story-map :global(.edge-goto .gm-edge-line) {
        stroke: var(--color-secondary-500);
    }
    .story-map :global(.edge-script .gm-edge-arrow),
    .story-map :global(.edge-goto .gm-edge-arrow) {
        fill: var(--color-secondary-500);
    }
    .story-map :global(.edge-auto.gm-edge-line),
    .story-map :global(.edge-auto .gm-edge-line) {
        stroke: var(--color-surface-400-600);
        stroke-dasharray: 2 3;
        stroke-width: 1;
    }
    .story-map :global(.edge-auto .gm-edge-arrow) {
        fill: var(--color-surface-400-600);
    }
    .story-map :global(.conditional.gm-edge-line),
    .story-map :global(.conditional .gm-edge-line) {
        stroke-dasharray: 5 4;
    }
    .story-map :global(.broken.gm-edge-line),
    .story-map :global(.broken .gm-edge-line) {
        stroke: var(--color-error-500);
    }
    .story-map :global(.broken .gm-edge-arrow) {
        fill: var(--color-error-500);
    }
    .story-map :global(.trace.gm-edge-line),
    .story-map :global(.trace .gm-edge-line) {
        stroke: var(--color-success-500);
        stroke-width: 2.5;
    }
    .story-map :global(.trace .gm-edge-arrow) {
        fill: var(--color-success-500);
    }
    /* The way the player went stands out, however long its links */
    .story-map :global(.gm-edge.trace[data-long]) {
        opacity: 1;
    }

    .map-key svg {
        overflow: visible;
    }
    .key-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 14px;
        font-size: 9px;
        border-radius: 3px;
        border: 1px solid var(--color-surface-400-600);
    }
    .key-start {
        color: var(--color-primary-500);
        border-color: var(--color-primary-500);
    }
    .key-ending {
        outline: 1px solid var(--color-surface-400-600);
        outline-offset: -4px;
        color: transparent;
    }
    .key-dead-end {
        border-color: var(--color-warning-500);
        color: var(--color-warning-500);
        font-weight: 700;
    }
    .key-unreachable {
        border-style: dashed;
        opacity: 0.5;
    }
    .link-chip {
        padding: 0 0.4rem;
        border-radius: 0.25rem;
        background-color: var(--color-surface-200-800);
    }
    .link-chip:hover {
        background-color: var(--color-surface-300-700);
    }
    .link-chip-missing {
        color: var(--color-error-700-300);
    }
</style>
