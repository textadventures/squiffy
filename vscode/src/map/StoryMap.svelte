<script lang="ts">
    // The story map in VS Code (#615): the editor's map (app/src/components/MapPanel.svelte), drawn
    // by @textadventures/graph-map from the language server's story graph, in a webview. Clicking
    // a box goes to it in the editor, the cursor's section is highlighted, and dragging from a box
    // to another adds a link, which the extension makes as an edit. Coloured by VS Code's theme.
    import { untrack } from "svelte";
    import type { MapPositions } from "squiffy-compiler";
    import type { GraphNode, StoryGraph } from "squiffy-compiler/language-service";
    import GraphMap, { type NodeState } from "@textadventures/graph-map/GraphMap.svelte";
    import StoryMapNodeBox from "@textadventures/squiffy-app/StoryMapNode.svelte";
    import { BOX_SIZE_CHOICES, DETAIL_ZOOMS, buildStoryMap, linkTo, nodeSizes, pinnedPositions, reachNote, searchMap, storyMapLayout, type NodeTexts, type StoryMapEdge, type StoryMapNode } from "@textadventures/squiffy-app/story-map";
    import type { FromMap, Point, ToMap, TraceStep } from "./messages.js";
    import Menu, { type MenuItem } from "./Menu.svelte";

    let { post }: { post: (message: FromMap) => void } = $props();

    // Above this, the map is slow to lay out, so it asks first, as the editor's does
    const LARGE = 6000;

    let graph = $state.raw<StoryGraph | null>(null);
    let positions = $state.raw<MapPositions | undefined>(undefined);
    let current = $state<string | null>(null);
    let selected = $state<string | null>(null);
    let showLarge = $state(false);
    let keyOpen = $state(false);
    let map = $state<ReturnType<typeof GraphMap<StoryMapNode, StoryMapEdge>>>();
    const layout = storyMapLayout();

    const base = $derived(graph ? buildStoryMap(graph, nodeSizes(positions, graph)) : null);
    const pinned = $derived(pinnedPositions(positions, graph));
    const tooLarge = $derived(!!base && base.nodes.length > LARGE && !showLarge);

    // The map's graph, with the cursor's section or passage marked
    // The search: boxes whose names, or text, have it in them (#679). The rest are dimmed, as on
    // the editor's map. The extension sends the text while there's a search.
    let query = $state("");
    let searchInput = $state<HTMLInputElement>();
    let texts = $state.raw<NodeTexts | undefined>(undefined);
    const searching = $derived(query.trim() != "");
    $effect(() => {
        const on = searching;
        untrack(() => post({ type: "searching", on }));
        if (!on) texts = undefined;
    });
    const matching = $derived(base ? searchMap(base.nodes, query, texts) : null);

    // Where the player has been in the preview, and the links they took between those places,
    // as on the editor's map
    let trace = $state.raw<TraceStep[]>([]);
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

    // The map's graph, with the cursor's section or passage, the search and the trace as classes
    const decorated = $derived.by(() => {
        if (!base) return null;
        if (!current && !matching && !trace.length) return base;
        const found = matching && new Set(matching.map(n => n.id));
        const hidden = (id: string) => !!found && !found.has(id);
        const nodes = base.nodes.map(n => {
            const extra = [n.id == current ? "current" : "", traced.visited.has(n.id) ? "visited" : "", hidden(n.id) ? "filtered-out" : ""].filter(Boolean);
            return extra.length ? { ...n, class: `${n.class} ${extra.join(" ")}` } : n;
        });
        const edges = base.edges.map(e => {
            const extra = [traced.taken.has(e.id) ? "trace" : "", hidden(e.from) || hidden(e.to) ? "filtered-out" : ""].filter(Boolean);
            return extra.length ? { ...e, class: `${e.class} ${extra.join(" ")}` } : e;
        });
        return { nodes, edges };
    });

    // Typing brings the first match into view
    $effect(() => {
        const first = matching?.[0];
        if (first) untrack(() => { if (map?.has(first.id)) map.reveal(first.id); });
    });

    // Enter selects the next match (Shift+Enter the one before), and Escape clears the search
    function searchKey(e: KeyboardEvent) {
        if (e.key == "Escape") {
            e.preventDefault();
            query = "";
            map?.focus();
        } else if (e.key == "Enter" && matching?.length) {
            e.preventDefault();
            const index = matching.findIndex(n => n.id == selected);
            const step = e.shiftKey ? -1 : 1;
            const next = matching[index < 0 ? (e.shiftKey ? matching.length - 1 : 0) : (index + step + matching.length) % matching.length];
            map?.select(next.id);
            map?.reveal(next.id);
        }
    }
    // "3 matches", or "2 of 3" once Enter has gone to one
    const matchCount = $derived.by(() => {
        if (!matching) return "";
        if (!matching.length) return "No matches";
        const index = matching.findIndex(n => n.id == selected);
        if (index >= 0) return `${index + 1} of ${matching.length}`;
        return matching.length == 1 ? "1 match" : `${matching.length} matches`;
    });

    export function receive(message: ToMap) {
        if (message.type == "graph") {
            // Renamed nodes keep their places. The ids can swap or shift along, so they go
            // through temporary ids first.
            for (const [from, to] of message.renamed) map?.rename(from, `\u0000${to}`);
            for (const [, to] of message.renamed) map?.rename(`\u0000${to}`, to);
            graph = message.graph;
            positions = message.positions;
        } else if (message.type == "current") {
            current = message.id;
        } else if (message.type == "select") {
            selectWhenReady = message.id;
        } else if (message.type == "trace") {
            trace = message.steps;
        } else if (message.type == "relayout") {
            map?.relayout(new Map());
        } else if (message.type == "search") {
            searchInput?.focus();
            searchInput?.select();
        } else if (message.type == "texts") {
            if (searching) texts = new Map(Object.entries(message.texts));
        } else if (message.type == "excerpt") {
            waiting.get(message.request)?.(message.text);
            waiting.delete(message.request);
        }
    }

    // ---- Previews, as on the editor's map ----

    // Each node's excerpt, asked for from the extension once for each version of the story
    let excerpts = new Map<string, Promise<string>>();
    let excerptsFor: StoryGraph | null = null;
    const waiting = new Map<number, (text: string) => void>();
    let nextRequest = 0;
    // `long` for the box itself, which may be big (#681)
    function excerptOf(g: GraphNode, long = false): Promise<string> {
        if (excerptsFor !== graph) {
            excerpts = new Map();
            excerptsFor = graph;
        }
        const key = long ? `long:${g.id}` : g.id;
        let found = excerpts.get(key);
        if (!found) {
            const request = ++nextRequest;
            found = new Promise<string>(resolve => waiting.set(request, resolve));
            excerpts.set(key, found);
            post({ type: "excerpt", request, id: g.id, ...(long ? { long } : {}) });
        }
        return found;
    }

    // The selected box's excerpt, for its details
    let selectedExcerpt = $state("");
    $effect(() => {
        const g = selectedNode?.graphNode;
        void graph;
        selectedExcerpt = "";
        if (!g) return;
        let current = true;
        void excerptOf(g).then(text => { if (current) selectedExcerpt = text; });
        return () => { current = false; };
    });

    // A card shown a moment after the mouse moves onto a box: what it is and the start of its text,
    // in place of a tooltip, which takes longer to appear
    const HOVER_DELAY = 350;
    let hover = $state<{ node: StoryMapNode; box: DOMRect; excerpt: string } | null>(null);
    let hoverTimer: ReturnType<typeof setTimeout> | undefined;
    function handleHover(node: StoryMapNode | null, box: DOMRect | null) {
        clearTimeout(hoverTimer);
        hover = null;
        if (!node || !box || menu) return;
        hoverTimer = setTimeout(async () => {
            const text = node.graphNode ? await excerptOf(node.graphNode) : "";
            hover = { node, box, excerpt: text };
        }, HOVER_DELAY);
    }
    $effect(() => () => clearTimeout(hoverTimer));
    // What the box's marks mean: its tooltip, after its name
    const hoverNotes = (n: StoryMapNode) => (n.title ?? "").split("\n").slice(1);
    // Below the box, or above it if there's no room below
    function hoverStyle(box: DOMRect) {
        const below = window.innerHeight - box.bottom > 160;
        const left = Math.max(8, Math.min(box.left + box.width / 2 - 144, window.innerWidth - 296));
        return below ? `left: ${left}px; top: ${box.bottom + 6}px;` : `left: ${left}px; bottom: ${window.innerHeight - box.top + 6}px;`;
    }

    // A section or passage just made from the map is selected once the map has it
    let selectWhenReady: string | null = null;
    $effect(() => {
        void decorated;
        const id = selectWhenReady;
        untrack(() => {
            if (!id || !map?.has(id)) return;
            selectWhenReady = null;
            map.select(id);
            map.reveal(id);
        });
    });

    // The editor's cursor brings its section into view
    let lastCurrent: string | null = null;
    $effect(() => {
        const id = current;
        void decorated;
        if (id == lastCurrent) return;
        untrack(() => {
            if (!id || !map?.has(id)) return;
            lastCurrent = id;
            map.reveal(id);
        });
    });

    // To another box, a link to it; to empty space, a new section there
    function canConnect(from: StoryMapNode, to: StoryMapNode | null) {
        if (!from.graphNode) return false;
        if (!to) return true;
        return !!to.graphNode && "text" in linkTo(from.graphNode, to.graphNode);
    }

    // A point the map gives, which can be part of its state, as a plain object that can be posted
    // to the extension (a Svelte state proxy can't be)
    const plain = (p: Point): Point => ({ x: p.x, y: p.y });

    // A new section, its box at `at`, after the selected box in the script, or the nearest one
    function create(at: Point) {
        const near = (selected ? base?.nodes.find(n => n.id == selected) : undefined)?.graphNode ?? map?.nearest(at, n => !!n.graphNode)?.graphNode;
        post({ type: "create", at: plain(at), near: near?.id });
    }

    // What a broken link's marker is missing: a section, or a passage in the section it's from.
    // Not an embed, or a name only known when the story runs.
    function canCreateMissing(node: StoryMapNode) {
        const kind = node.brokenEdge?.kind;
        return kind == "passage-link" || kind == "section-link" || kind == "goto";
    }

    function createMissing(node: StoryMapNode) {
        const edge = node.brokenEdge;
        if (!edge) return;
        const at = map?.positionOf(node.id);
        post({ type: "createMissing", edge: { from: edge.from, kind: edge.kind, target: edge.target }, at: at && plain(at) });
    }

    function activate(node: StoryMapNode, how: "click" | "open") {
        // Opening a broken link's marker makes what's missing, as in the editor
        if (node.kind == "missing" && how == "open" && canCreateMissing(node)) {
            createMissing(node);
            return;
        }
        // Clicking one goes to the link
        const location = node.kind == "missing" ? node.brokenEdge?.location : node.graphNode?.location;
        if (location) post({ type: "goto", location, focus: how == "open" });
    }

    function activateEdge(edge: StoryMapEdge) {
        const location = edge.edges[0]?.location ?? edge.location;
        if (location) post({ type: "goto", location, focus: false });
    }

    // Named sections and passages can be deleted here. A section without a name of its own
    // (+++, ---, the text before the first section) is part of what's around it in the script.
    const canDelete = (g: GraphNode) => g.kind == "passage" || (!g.detail && g.name != "");

    function remove(nodes: StoryMapNode[]) {
        const ids = nodes.flatMap(n => n.graphNode && canDelete(n.graphNode) ? [n.graphNode.id] : []);
        if (ids.length) post({ type: "delete", ids });
    }

    // The right-click menu, for a box, a broken link's marker, or the background
    // `back` is what has the focus again when it closes, if not the map
    let menu = $state<{ x: number; y: number; keyboard: boolean; items: MenuItem[]; back?: HTMLElement } | null>(null);

    // Choices of the box's size (#681), after the rest of a menu (`divider`), or on their own
    function sizeItems(node: StoryMapNode, id: string, divider = true): MenuItem[] {
        return BOX_SIZE_CHOICES.map(([size, label], i) => ({
            label,
            checked: node.size === size,
            divider: divider && i == 0,
            action: () => { if (node.size !== size) post({ type: "resize", id, ...(size ? { size } : {}) }); },
        }));
    }

    // The Size button in the selected box's details: the same choices, under it
    function showSizes(e: MouseEvent, node: StoryMapNode, id: string) {
        const button = e.currentTarget as HTMLElement;
        const rect = button.getBoundingClientRect();
        // detail is 0 for Enter or Space, so the first choice gets the focus
        menu = { x: rect.left, y: rect.bottom + 2, keyboard: e.detail === 0, items: sizeItems(node, id, false), back: button };
    }

    function showMenu(node: StoryMapNode | null, at: Point, screen: Point, keyboard: boolean) {
        const g = node?.graphNode;
        let items: MenuItem[];
        if (node?.kind == "missing") {
            const edge = node.brokenEdge;
            items = [
                ...(canCreateMissing(node) ? [{ label: edge?.kind == "passage-link" ? "Add this passage" : "Add this section", shortcut: "Enter", action: () => createMissing(node) }] : []),
                { label: "Show the link in the script", action: () => activate(node, "click") },
            ];
        } else if (node && g) {
            const id = g.id;
            items = [
                { label: "Show in the script", shortcut: "Enter", action: () => activate(node, "open") },
                { label: "Rename…", shortcut: "F2", disabled: !!g.detail, action: () => post({ type: "rename", id }) },
                { label: "Add a passage…", action: () => post({ type: "addPassage", id }) },
                { label: "Run from here", divider: true, action: () => post({ type: "run", id }) },
                ...(g.kind == "section" ? [{ label: "Start the story here", disabled: !!g.start || !!g.detail || g.name == "", action: () => post({ type: "start", id }) }] : []),
                ...(isDeadEnd(g) ? [{ label: "Mark as an ending", action: () => post({ type: "ending", id }) }] : []),
                ...sizeItems(node, id),
                { label: "Delete…", shortcut: "Del", divider: true, disabled: !canDelete(g), action: () => post({ type: "delete", ids: [id] }) },
            ];
        } else {
            items = [
                { label: "Add a section here…", action: () => create(at) },
                { label: "Zoom in", shortcut: "+", divider: true, action: () => map?.zoomBy(1.25) },
                { label: "Zoom out", shortcut: "-", action: () => map?.zoomBy(0.8) },
                { label: "Show the whole story", shortcut: "0", action: () => map?.fit() },
                { label: "Lay out again…", divider: true, action: () => post({ type: "relayout" }) },
            ];
        }
        menu = { ...screen, keyboard, items };
    }

    // The selected box's details, along the bottom of the map: what it is, what it can do, and
    // where it links to and from, as on the editor's map
    const selectedNode = $derived(selected && base ? base.nodes.find(n => n.id == selected) : undefined);
    const links = $derived.by(() => {
        if (!base || !selectedNode) return { out: [], into: [] };
        const byId = new Map(base.nodes.map(n => [n.id, n]));
        const unique = (list: StoryMapNode[]) => [...new Map(list.map(n => [n.id, n])).values()];
        return {
            out: unique(base.edges.filter(e => e.from == selectedNode.id && e.kind != "auto").flatMap(e => byId.get(e.to) ?? [])),
            into: unique(base.edges.filter(e => e.to == selectedNode.id && e.kind != "auto").flatMap(e => byId.get(e.from) ?? [])),
        };
    });
    // A section the player can reach with no way out, which isn't marked as an ending
    const isDeadEnd = (g: GraphNode) => g.kind == "section" && !!g.deadEnd && g.reachable;

    function notes(g: GraphNode, graph: StoryGraph) {
        return [
            g.start ? "The story starts here." : "",
            g.ending ? "An ending." : "",
            isDeadEnd(g) ? "A dead end: there's no way out." : "",
            g.embedded ? "Shown inside other sections, with {{embed}} or {{live}}." : reachNote(g, graph),
        ].filter(Boolean).join(" ");
    }

    // The selected box is brought out from under the details
    let details = $state<HTMLDivElement>();
    let detailsWidth = $state(0);
    let detailsHeight = $state(0);
    $effect(() => {
        const id = selected;
        const el = details;
        void detailsWidth;
        void detailsHeight;
        if (id) untrack(() => { if (map?.has(id)) map.reveal(id, { over: el ? [el.getBoundingClientRect()] : [] }); });
    });

    // The menu key, or Shift+F10, opens the menu for the selected box. In VS Code's webview,
    // they don't make a contextmenu event of their own, as they do in a browser, so the map's
    // keyboard menu gets one here.
    function menuKey(e: KeyboardEvent) {
        if (!(e.key == "ContextMenu" || (e.key == "F10" && e.shiftKey)) || e.altKey || e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        e.target?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 0 }));
    }

    const instructions = "Arrow keys move between sections and passages, and Enter goes to one in the editor. F2 renames it and Delete deletes it. The menu key, or Shift and F10, opens a menu for it. Control or Command and F searches the map. Plus and minus zoom, and 0 fits the whole story in view. Double-click the background to add a section there. Drag the background to pan, a box to move it, or the dot under the selected box to another box to add a link, or to empty space to add a section with a link to it. Shift and drag the background to select several boxes, or Shift and click one, then drag one of them to move them all.";
</script>

<main class="story-map">
    <div class="toolbar" role="toolbar" aria-label="Story map">
        <button type="button" title="Add a section" aria-label="Add a section" onclick={() => create(map?.centre() ?? { x: 0, y: 0 })}>Add a section</button>
        <button type="button" title="Zoom in (+)" aria-label="Zoom in" onclick={() => map?.zoomBy(1.25)}>+</button>
        <button type="button" title="Zoom out (-)" aria-label="Zoom out" onclick={() => map?.zoomBy(0.8)}>−</button>
        <button type="button" title="Show the whole story (0)" aria-label="Show the whole story" onclick={() => map?.fit()}>Fit</button>
        <button type="button" title="What the map's colours and lines mean" aria-expanded={keyOpen} onclick={() => { keyOpen = !keyOpen; }}>Key</button>
        <div class="search">
            <input
                bind:this={searchInput}
                bind:value={query}
                type="search"
                placeholder="Search"
                aria-label="Search the map"
                title="Search the map, by name or text (Enter goes to the next match, Escape clears it)"
                onkeydown={searchKey}
            />
            <span class="count" aria-live="polite">{matchCount}</span>
        </div>
    </div>
    {#if keyOpen}
        <div class="key">
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
            <span></span><span class="key-help">Drag the dot under the selected box to another to add a link, or to empty space for a new section. Double-click empty space to add a section, or a red box to add what's missing. Right-click a box for more, or the background to lay the map out again. Shift+drag empty space, or Shift+click, to select several boxes and move them together.</span>
        </div>
    {/if}
    <div class="area">
        {#if !decorated}
            <p class="message">Reading the story…</p>
        {:else if tooLarge}
            <div class="message">
                <p>This story has {base!.nodes.length.toLocaleString()} sections and passages, which is a lot to show on a map. It may be slow.</p>
                <button type="button" onclick={() => { showLarge = true; }}>Show it anyway</button>
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
                onactivate={activate}
                onedgeactivate={activateEdge}
                onrename={n => { if (n.graphNode && !n.graphNode.detail) post({ type: "rename", id: n.graphNode.id }); }}
                ondelete={remove}
                onmenu={showMenu}
                onmove={moves => post({ type: "move", moves: moves.flatMap(({ node, at }) => node.graphNode ? [{ id: node.graphNode.id, at: plain(at) }] : []) })}
                onconnect={(from, to, at) => {
                    if (!from.graphNode) return;
                    if (!to) post({ type: "create", at: plain(at), from: from.graphNode.id });
                    else if (to.graphNode) post({ type: "link", from: from.graphNode.id, to: to.graphNode.id });
                }}
                oncreate={create}
                onhover={handleHover}
                node={drawNode}
                detailZooms={DETAIL_ZOOMS}
            />
            {#if selectedNode?.graphNode && graph}
                {@const g = selectedNode.graphNode}
                {@const note = notes(g, graph)}
                <div class="details" bind:this={details} bind:clientWidth={detailsWidth} bind:clientHeight={detailsHeight} role="region" aria-label="Selected {selectedNode.kind}">
                    <div class="details-name" title={selectedNode.label}>{selectedNode.kind == "section" ? "Section" : "Passage"}: {selectedNode.label}</div>
                    <div class="details-actions">
                        <button type="button" title="Show in the script (Enter)" onclick={() => activate(selectedNode, "open")}>Show</button>
                        {#if !g.detail}
                            <button type="button" title="Rename (F2)" onclick={() => post({ type: "rename", id: g.id })}>Rename</button>
                        {/if}
                        <button type="button" title="Add a passage" onclick={() => post({ type: "addPassage", id: g.id })}>Add a passage</button>
                        <button type="button" title="Run the preview from here" onclick={() => post({ type: "run", id: g.id })}>Run</button>
                        <button type="button" title="Make the box bigger, or the usual size" aria-haspopup="menu" aria-expanded={!!menu?.back} onclick={e => showSizes(e, selectedNode, g.id)}>Size…</button>
                        {#if isDeadEnd(g)}
                            <button type="button" title="Mark it as one of the story's endings, with @end" onclick={() => post({ type: "ending", id: g.id })}>Mark as an ending</button>
                        {/if}
                        {#if canDelete(g)}
                            <button type="button" title="Delete (Del)" onclick={() => post({ type: "delete", ids: [g.id] })}>Delete</button>
                        {/if}
                    </div>
                    {#if selectedExcerpt}
                        <p class="excerpt">{selectedExcerpt}</p>
                    {/if}
                    {#if note}
                        <p class="details-note">{note}</p>
                    {/if}
                    {#if links.out.length}
                        <p class="details-links"><span>Links to</span>
                            {#each links.out as n (n.id)}<button type="button" class="chip" class:chip-missing={n.kind == "missing"} title={n.kind == "missing" ? "Missing: add it" : `Select ${n.label}`} onclick={() => n.kind == "missing" ? activate(n, "open") : map?.select(n.id)}>{n.label}</button>{/each}
                        </p>
                    {/if}
                    {#if links.into.length}
                        <p class="details-links"><span>Linked from</span>
                            {#each links.into as n (n.id)}<button type="button" class="chip" title="Select {n.label}" onclick={() => map?.select(n.id)}>{n.label}</button>{/each}
                        </p>
                    {/if}
                </div>
            {/if}
            {#if decorated.nodes.length === 0}
                <p class="message overlay">No sections yet.</p>
            {/if}
        {/if}
    </div>
</main>

<svelte:window onkeydown={menuKey} />

{#if hover}
    {@const n = hover.node}
    <div class="hover" style={hoverStyle(hover.box)} aria-hidden="true">
        <p class="hover-name">{n.kind == "missing" ? n.label : `${n.kind == "section" ? "Section" : "Passage"}: ${n.label}`}</p>
        {#if hover.excerpt}
            <p class="excerpt">{hover.excerpt}</p>
        {:else if n.graphNode}
            <p class="hover-note"><em>No text yet.</em></p>
        {/if}
        {#each hoverNotes(n) as note, i (i)}
            <p class="hover-note">{note}</p>
        {/each}
        {#if n.graphNode}
            <p class="hover-note">Double-click to go to it in the script.</p>
        {/if}
    </div>
{/if}

{#if menu}
    <Menu x={menu.x} y={menu.y} keyboard={menu.keyboard} items={menu.items} onclose={() => { const back = menu?.back; menu = null; (back?.isConnected ? back : map)?.focus(); }} />
{/if}

{#snippet drawNode(n: StoryMapNode, state: NodeState)}
    <StoryMapNodeBox node={n} {state} excerpt={n.graphNode ? () => excerptOf(n.graphNode!, true) : undefined} />
{/snippet}
