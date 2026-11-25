<script lang="ts" module>
    // A place the player went to in the preview
    export interface TraceStep {
        section: string;
        passage?: string;
    }
</script>

<script lang="ts">
    import { tick, untrack } from "svelte";
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
    import ContextMenu, { type ContextMenuItem } from "#components/ContextMenu.svelte";
    import StoryMapNodeBox from "#components/StoryMapNode.svelte";
    import { checkPassageName } from "#lib/map-edits.js";
    import { buildStoryMap, checkSectionName, linkTo, pinnedPositions, reachNote, storyMapLayout, type Point, type StoryMapEdge, type StoryMapNode } from "#lib/story-map.js";
    import ZoomIn from "@lucide/svelte/icons/zoom-in";
    import ZoomOut from "@lucide/svelte/icons/zoom-out";
    import Scan from "@lucide/svelte/icons/scan";
    import RefreshCcw from "@lucide/svelte/icons/refresh-ccw";
    import CircleHelp from "@lucide/svelte/icons/circle-help";
    import Plus from "@lucide/svelte/icons/plus";
    import X from "@lucide/svelte/icons/x";
    import Pencil from "@lucide/svelte/icons/pencil";
    import Play from "@lucide/svelte/icons/play";
    import Code from "@lucide/svelte/icons/code";
    import ListPlus from "@lucide/svelte/icons/list-plus";
    import SquarePen from "@lucide/svelte/icons/square-pen";
    import Trash2 from "@lucide/svelte/icons/trash-2";

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
        // Full screen, the id of the section being written in a card over the map, if one is
        card: string | null;
        // Write a section (or the section a passage is in) beside the full-screen map, taking the
        // focus or not
        onedit: (node: GraphNode, focus: boolean) => void;
        width?: number;
        // Go to a node (or a broken link) in the editor, taking the focus or not
        ongoto: (node: StoryMapNode, focus: boolean) => void;
        ongotoedge: (edge: StoryMapEdge) => void;
        // Sections and passages were dropped somewhere (several, if they were dragged together)
        onmove: (moves: { node: GraphNode; at: Point }[]) => void;
        // Add a link from one node to another, or to a new section called `name`
        onlink: (from: GraphNode, to: GraphNode | null, at: Point, name?: string) => void;
        // Add a section: at a place on the map, after `near` in the script; or for a broken link
        // from `from`, which is there already (`link` is false)
        oncreate: (name: string, where: { at?: Point; near?: GraphNode; from?: GraphNode; link?: boolean }) => void;
        // Rename a section or passage. Resolves to why it can't have that name, if it can't.
        onrename: (node: GraphNode, name: string) => Promise<string | undefined>;
        onrun: (node: GraphNode) => void;
        // Add a passage to a section, linked from it or from one of its passages (unless `link`
        // is false, for a broken link that's there already)
        onaddpassage: (from: GraphNode, name: string, link?: boolean) => void;
        ondelete: (nodes: GraphNode[]) => void;
        // Make the story start at a section
        onstart: (node: GraphNode) => void;
        // Undo or redo the last change to the script
        onundo: (redo: boolean) => void;
        // Forget every position the author chose
        onrelayout: () => Promise<boolean>;
        onclose: () => void;
        // A short preview of a section's or passage's text, for hovering over its box and for the
        // selected box's details
        excerpt?: (node: GraphNode) => Promise<string>;
    }

    let {
        graph, positions, query, current, trace, maximized, card, onedit, width, ongoto, ongotoedge, onmove, onlink, oncreate, onrename,
        onrun, onaddpassage, ondelete, onstart, onundo, onrelayout, onclose, excerpt,
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
        if (id && map?.has(id)) map.reveal(id, covered());
    });

    // What's over the map: the details of the selected box, which don't take space from the map,
    // so that selecting a box doesn't move it
    let details = $state<HTMLDivElement>();
    let detailsWidth = $state(0);
    let detailsHeight = $state(0);
    const covered = () => ({ over: details ? [details.getBoundingClientRect()] : [] });

    // The selected box is brought out from under them
    $effect(() => {
        const id = selected;
        void card;
        void details;
        void detailsWidth;
        void detailsHeight;
        if (id) untrack(() => { if (map?.has(id)) map.reveal(id, covered()); });
    });

    // Opening a section beside the map makes the map narrower, but leaves its boxes where they are
    $effect(() => {
        if (card) untrack(() => map?.keepView());
    });

    // When the map's resized, e.g. as a section's opened beside it, the selected box stays in view.
    // A frame later, once the map knows its new size.
    let areaWidth = $state(0);
    let areaHeight = $state(0);
    $effect(() => {
        void areaWidth;
        void areaHeight;
        const id = untrack(() => selected);
        if (!id) return;
        const frame = requestAnimationFrame(() => { if (map?.has(id)) map.reveal(id, covered()); });
        return () => cancelAnimationFrame(frame);
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

    // With follow false, a section being written beside the map stays where it is, for going to a
    // place in it (a problem, say) rather than to its start
    export function focusNode(id: string, announce = true, follow = true) {
        if (!follow) followed = id;
        map?.select(id, announce);
    }

    export function focus() {
        map?.focus();
    }

    function canConnect(from: StoryMapNode, to: StoryMapNode | null) {
        if (!from.graphNode) return false;
        if (!to) return true;
        return !!to.graphNode && "text" in linkTo(from.graphNode, to.graphNode);
    }

    function handleActivate(node: StoryMapNode, how: "click" | "open") {
        if (how == "open") finishHint();
        if (node.kind == "missing") {
            // Opening a broken link's marker makes what's missing; otherwise, to the link
            if (how == "open" && createMissing(node)) return;
            // Full screen, a click just selects, as for any box
            if (how == "click" && maximized) return;
            ongotoedge({ id: "", from: "", to: node.id, kind: node.brokenEdge!.kind, edges: [node.brokenEdge!], conditional: false });
            return;
        }
        // Full screen, the script's out of sight: a click just selects, and opening a box shows
        // its section beside the map, to write there
        if (maximized) {
            if (how == "open" && node.graphNode) onedit(node.graphNode, true);
            return;
        }
        ongoto(node, how == "open");
    }

    // While a section's being written beside the map, selecting another box shows that one
    let followed: string | null = null;
    $effect(() => {
        const g = selectedNode?.graphNode;
        if (!maximized || !card || !g) {
            followed = null;
            return;
        }
        if (g.id == followed) return;
        followed = g.id;
        untrack(() => onedit(g, false));
    });

    // ---- Previews ----

    // Each node's excerpt, worked out once for each version of the story
    let excerpts = new Map<string, Promise<string>>();
    let excerptsFor: StoryGraph | null = null;
    function excerptOf(g: GraphNode): Promise<string> {
        if (!excerpt) return Promise.resolve("");
        if (excerptsFor !== graph) {
            excerpts = new Map();
            excerptsFor = graph;
        }
        let found = excerpts.get(g.id);
        if (!found) excerpts.set(g.id, found = excerpt(g).catch(() => ""));
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
    // in place of a tooltip, which takes longer to appear and can't be styled
    const HOVER_DELAY = 350;
    let hover = $state<{ node: StoryMapNode; box: DOMRect; excerpt: string } | null>(null);
    let hoverTimer: ReturnType<typeof setTimeout> | undefined;
    function handleHover(node: StoryMapNode | null, box: DOMRect | null) {
        clearTimeout(hoverTimer);
        hover = null;
        if (!node || !box || naming || menu) return;
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

    // ---- Finding out how to open a box ----

    // A hint at the top of the map, until a box has been opened from it (in this browser)
    const HINT_KEY = "squiffy-map-open-hint-done";
    let hintDone = $state(readHintDone());
    function readHintDone() {
        try {
            return localStorage.getItem(HINT_KEY) === "1";
        } catch {
            return false;
        }
    }
    function finishHint() {
        if (hintDone) return;
        hintDone = true;
        try {
            localStorage.setItem(HINT_KEY, "1");
        } catch {
            // Shown again next time, then
        }
    }

    async function handleRelayout() {
        if (await onrelayout()) map?.relayout(new Map());
    }

    // ---- Names, typed on the map ----

    // A box to type a name in, where the section or passage is, or will be
    let naming = $state<{
        x: number; y: number; label: string; value: string; error: string; busy: boolean;
        // Says why the name can't be used, if it can't
        submit: (name: string) => string | undefined | Promise<string | undefined>;
    } | null>(null);
    let nameInput = $state<HTMLInputElement>();

    function askName(at: Point, label: string, value: string, submit: NonNullable<typeof naming>["submit"]) {
        if (!map) return;
        naming = { ...map.screenPoint(at), label, value, error: "", busy: false, submit };
        void tick().then(() => {
            nameInput?.focus();
            nameInput?.select();
        });
    }

    function stopNaming(refocus: boolean) {
        if (!naming) return;
        naming = null;
        if (refocus) map?.focus();
    }

    async function submitName() {
        const current = naming;
        if (!current || current.busy) return;
        const name = current.value.trim();
        if (!name) {
            stopNaming(true);
            return;
        }
        current.busy = true;
        const error = await current.submit(name);
        if (naming !== current) return;
        if (error) {
            current.error = error;
            current.busy = false;
            nameInput?.focus();
        } else {
            stopNaming(true);
        }
    }

    // A new section goes in the script after the selected one, or else the one nearest on the map
    function create(at: Point) {
        const near = selectedNode?.graphNode ?? map?.nearest(at, n => !!n.graphNode)?.graphNode;
        askName(at, "New section's name", "", name => {
            const problem = graph ? checkSectionName(name, graph) : undefined;
            if (!problem) oncreate(name, { at, near });
            return problem;
        });
    }

    // A link dragged to empty space, for a new section there
    function createLinked(from: GraphNode, at: Point) {
        askName(at, "New section's name", "", name => {
            const problem = graph ? checkSectionName(name, graph) : undefined;
            if (!problem) onlink(from, null, at, name);
            return problem;
        });
    }

    function renameNode(g: GraphNode) {
        const at = map?.positionOf(g.id);
        if (g.detail || !at) return;
        askName(at, `New name for ${g.name}`, g.name, name => name == g.name ? undefined : onrename(g, name));
    }

    function addPassage(g: GraphNode) {
        const node = base?.nodes.find(n => n.id == g.id);
        const at = map?.positionOf(g.id);
        if (!node || !at) return;
        const section = g.kind == "section" ? g.name : g.section!;
        // Under the box it's added from, where passages hang
        askName({ x: at.x, y: at.y + node.height + 8 }, "New passage's name", "", name => {
            const problem = graph ? checkPassageName(name, section, graph) : undefined;
            if (!problem) onaddpassage(g, name);
            return problem;
        });
    }

    // Asks for the name of a new section to go after `near` in the script, under its box, and of
    // a new passage in a section: for the app's own Add button, while the script's out of sight
    export function nameSection(near: GraphNode) {
        const node = base?.nodes.find(n => n.id == near.id);
        const at = map?.positionOf(near.id);
        if (!node || !at) return;
        askName({ x: at.x, y: at.y + node.height + 8 }, "New section's name", "", name => {
            const problem = graph ? checkSectionName(name, graph) : undefined;
            if (!problem) oncreate(name, { near });
            return problem;
        });
    }

    export function namePassage(section: GraphNode) {
        addPassage(section);
    }

    // A broken link's missing section or passage, made from its red marker. Says whether it can be:
    // an embed, or a name only known when the story runs, has to be sorted out in the script.
    function createMissing(node: StoryMapNode): boolean {
        const edge = node.brokenEdge;
        const from = edge && graph?.nodes.find(n => n.id == edge.from);
        const name = edge?.target;
        if (!edge || !from || !name || !graph) return false;
        if (edge.kind == "passage-link") {
            const section = from.kind == "section" ? from.name : from.section!;
            if (checkPassageName(name, section, graph)) return false;
            onaddpassage(from, name, false);
            return true;
        }
        if (edge.kind != "section-link" && edge.kind != "goto") return false;
        if (checkSectionName(name, graph)) return false;
        oncreate(name, { from, link: false });
        return true;
    }

    // Named sections and passages can be deleted here. A section without a name of its own
    // (+++, ---, the text before the first section) is part of what's around it in the script.
    const canDelete = (g: GraphNode) => g.kind == "passage" || (!g.detail && g.name != "");

    function handleDelete(nodes: StoryMapNode[]) {
        const deletable = nodes.flatMap(n => n.graphNode && canDelete(n.graphNode) ? [n.graphNode] : []);
        if (deletable.length) ondelete(deletable);
    }

    function handleKeydown(e: KeyboardEvent) {
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
        const key = e.key.toLowerCase();
        if (key != "z" && key != "y") return;
        e.preventDefault();
        onundo(key == "y" || e.shiftKey);
    }

    // The right-click menu, for a box or for the background
    let menu = $state<{ x: number; y: number; keyboard: boolean; items: ContextMenuItem[] } | null>(null);

    function showMenu(node: StoryMapNode | null, at: Point, screen: Point, keyboard: boolean) {
        const g = node?.graphNode;
        let items: ContextMenuItem[];
        if (node?.kind == "missing") {
            const edge = node.brokenEdge;
            const creatable = edge?.kind == "passage-link" || edge?.kind == "section-link" || edge?.kind == "goto";
            items = [
                ...(creatable ? [{ label: edge.kind == "passage-link" ? "Add this passage" : "Add this section", shortcut: "Enter", action: () => { createMissing(node); } }] : []),
                { label: "Show the link in the script", action: () => handleActivate(node, "click") },
            ];
        } else if (node && g) {
            const section = g.kind == "section";
            items = [
                ...(maximized ? [{ label: "Write here", shortcut: "Enter", action: () => onedit(g, true) }] : []),
                { label: "Show in the script", shortcut: maximized ? undefined : "Enter", action: () => ongoto(node, true) },
                { label: "Rename…", shortcut: "F2", disabled: !!g.detail, action: () => renameNode(g) },
                { label: "Add a passage…", action: () => addPassage(g) },
                { label: "Run from here", divider: true, action: () => onrun(g) },
                ...(section ? [{ label: "Start the story here", disabled: !!g.start || !!g.detail || g.name == "", action: () => onstart(g) }] : []),
                { label: "Delete…", shortcut: "Del", divider: true, disabled: !canDelete(g), action: () => ondelete([g]) },
            ];
        } else {
            items = [
                { label: "Add a section here…", action: () => create(at) },
                { label: "Show the whole story", shortcut: "0", divider: true, action: () => map?.fit() },
            ];
        }
        menu = { ...screen, keyboard, items };
    }

    const instructions = "Arrow keys move between sections and passages. Enter goes to one in the editor, or with just the map showing, shows it beside the map to write there. F2 renames it and Delete deletes it. The menu key, or Shift and F10, opens a menu for it. Control or Command and Z undoes the last change. Plus and minus zoom, and 0 fits the whole story in view. Drag the background to pan, a box to move it, or the dot under the selected box to add a link. Shift and drag the background to select several boxes, or Shift and click one, then drag one of them to move them all.";
</script>

<section
    aria-label="Story map"
    class="story-map flex flex-col overflow-hidden border-l border-surface-200-800 bg-surface-50-950 {width === undefined ? "flex-1 min-w-0" : "shrink-0"}"
    style={width === undefined ? undefined : `width: ${width}px`}
>
    <header class="flex items-center gap-0.5 px-2 py-1 border-b border-surface-200-800">
        <h2 class="text-[11px] font-semibold text-surface-600-400 uppercase tracking-wide flex-1 pl-1">Map</h2>
        <button type="button" class="btn-icon btn-icon-sm" title="Add a section" aria-label="Add a section" onclick={() => create(map?.centre() ?? { x: 0, y: 0 })}><Plus size={14} /></button>
        <button type="button" class="btn-icon btn-icon-sm" title="Zoom in (+)" aria-label="Zoom in" onclick={() => map?.zoomBy(1.25)}><ZoomIn size={14} /></button>
        <button type="button" class="btn-icon btn-icon-sm" title="Zoom out (-)" aria-label="Zoom out" onclick={() => map?.zoomBy(0.8)}><ZoomOut size={14} /></button>
        <button type="button" class="btn-icon btn-icon-sm" title="Show the whole story (0)" aria-label="Show the whole story" onclick={() => map?.fit()}><Scan size={14} /></button>
        <button type="button" class="btn-icon btn-icon-sm" title="Lay out again" aria-label="Lay out again" onclick={handleRelayout}><RefreshCcw size={14} /></button>
        <button type="button" class="btn-icon btn-icon-sm" title="Key" aria-label="Key" aria-expanded={keyOpen} onclick={() => { keyOpen = !keyOpen; }}><CircleHelp size={14} /></button>
        <!-- The toolbar's Code, Code + Map and Map switch between the script and the map. Beside
             the script, the map can be closed from here too. -->
        {#if !maximized}
            <button type="button" class="btn-icon btn-icon-sm" title="Close map" aria-label="Close map" onclick={onclose}><X size={14} /></button>
        {/if}
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
            <span></span><span class="text-surface-600-400 pt-1">{maximized ? "Double-click a box, or select it and press Enter, to write in it beside the map." : "Double-click a box, or select it and press Enter, to go to it in the script."} Hover over a box to see the start of its text. Drag the dot under the selected box to another to add a link, or to empty space for a new section. Double-click empty space to add a section, or a red box to add what's missing. Right-click a box for more, or press Delete to delete it. Shift+drag empty space, or Shift+click, to select several boxes and move them together.</span>
        </div>
    {/if}
    <!-- The keydown catches Ctrl/Cmd+Z and Y as they bubble up from the map, which is the
         control, so undo works on the map's edits. This wrapper isn't a control itself (#639) -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div bind:clientWidth={areaWidth} bind:clientHeight={areaHeight} class="relative flex-1 min-h-0" onkeydown={handleKeydown}>
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
                onconnect={(from, to, at) => {
                    if (!from.graphNode) return;
                    if (to?.graphNode) onlink(from.graphNode, to.graphNode, at);
                    else if (!to) createLinked(from.graphNode, at);
                }}
                oncreate={create}
                onrename={n => { if (n.graphNode) renameNode(n.graphNode); }}
                ondelete={handleDelete}
                onmenu={showMenu}
                onhover={excerpt ? handleHover : undefined}
                node={drawNode}
            />
            {#if decorated.nodes.length === 0}
                <p class="absolute inset-0 p-4 text-sm text-surface-600-400 pointer-events-none">No sections yet.</p>
            {:else if !hintDone && !card}
                <p class="map-hint pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full border border-surface-200-800 bg-surface-50-950 shadow-sm pl-3 pr-1 py-0.5 text-xs flex items-center gap-1">
                    <span>{maximized ? "Double-click a box to write in it" : "Double-click a box to go to it in the script"}</span>
                    <button type="button" class="btn-icon btn-icon-sm pointer-events-auto" title="Hide this" aria-label="Hide this hint" onclick={finishHint}><X size={12} /></button>
                </p>
            {/if}
        {/if}
        {#if selectedNode?.graphNode}
            {@const g = selectedNode.graphNode}
            <div bind:this={details} bind:clientWidth={detailsWidth} bind:clientHeight={detailsHeight} class="map-details absolute left-2 bottom-2 rounded-md border border-surface-200-800 bg-surface-50-950 shadow-md px-3 py-2 text-xs space-y-1">
                <div class="flex items-center gap-1">
                    <span class="font-semibold truncate flex-1" title={selectedNode.label}>
                        {selectedNode.kind === "section" ? "Section" : "Passage"}: {selectedNode.label}
                    </span>
                    {#if maximized && card !== (g.kind == "section" ? g.id : `section:${g.section}`)}
                        <button type="button" class="btn btn-sm preset-filled-primary-500 px-2 py-0.5 gap-1" title="Write here (Enter, or double-click the box)" onclick={() => { finishHint(); onedit(g, true); }}><SquarePen size={13} />Write</button>
                    {/if}
                    <button type="button" class="btn-icon btn-icon-sm" title={maximized ? "Show in the script" : "Go to it in the editor (Enter)"} aria-label={maximized ? "Show in the script" : "Go to it in the editor"} onclick={() => ongoto(selectedNode, true)}><Code size={13} /></button>
                    {#if !g.detail}
                        <button type="button" class="btn-icon btn-icon-sm" title="Rename (F2)" aria-label="Rename" onclick={() => renameNode(g)}><Pencil size={13} /></button>
                    {/if}
                    <button type="button" class="btn-icon btn-icon-sm" title="Add a passage" aria-label="Add a passage" onclick={() => addPassage(g)}><ListPlus size={13} /></button>
                    <button type="button" class="btn-icon btn-icon-sm" title="Run from here" aria-label="Run from here" onclick={() => onrun(g)}><Play size={13} /></button>
                    {#if canDelete(g)}
                        <button type="button" class="btn-icon btn-icon-sm" title="Delete (Del)" aria-label="Delete" onclick={() => ondelete([g])}><Trash2 size={13} /></button>
                    {/if}
                </div>
                {#if selectedExcerpt}
                    <p class="map-excerpt text-surface-700-300">{selectedExcerpt}</p>
                {/if}
                {#if graph && (g.start || g.ending || (g.deadEnd && g.reachable) || !g.reachable)}
                    <p class="text-surface-600-400">
                        {[g.start ? "The story starts here." : "", g.ending ? "An ending." : "", g.deadEnd && g.reachable ? "A dead end: there's no way out. If it's an ending, add @end." : "", g.embedded ? "Shown inside other sections, with {{embed}} or {{live}}." : reachNote(g, graph)].filter(Boolean).join(" ")}
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
    </div>
</section>

{#if naming}
    <!-- Over the box being named, or where the new one will be -->
    <form
        class="name-box"
        style="left: {naming.x}px; top: {naming.y}px;"
        onsubmit={e => { e.preventDefault(); void submitName(); }}
    >
        <!-- The label's above the box, not in it, where it looks like a name that's there already -->
        <label for="map-name" class="name-label">{naming.label}</label>
        <input
            bind:this={nameInput}
            bind:value={naming.value}
            id="map-name"
            type="text"
            class="input text-sm text-center"
            aria-invalid={naming.error ? "true" : undefined}
            aria-describedby={naming.error ? "map-name-error" : undefined}
            autocomplete="off"
            spellcheck="false"
            oninput={() => { if (naming) naming.error = ""; }}
            onkeydown={e => { if (e.key == "Escape") { e.preventDefault(); e.stopPropagation(); stopNaming(true); } }}
            onblur={() => stopNaming(false)}
        />
        {#if naming.error}
            <p id="map-name-error" role="alert" class="name-error">{naming.error}</p>
        {/if}
    </form>
{/if}

{#if hover}
    {@const n = hover.node}
    <div class="map-hover" style={hoverStyle(hover.box)} aria-hidden="true">
        <p class="font-semibold">{n.kind == "missing" ? n.label : `${n.kind == "section" ? "Section" : "Passage"}: ${n.label}`}</p>
        {#if hover.excerpt}
            <p class="map-excerpt">{hover.excerpt}</p>
        {:else if n.graphNode}
            <p class="text-surface-600-400 italic">No text yet.</p>
        {/if}
        {#each hoverNotes(n) as note, i (i)}
            <p class="text-surface-600-400">{note}</p>
        {/each}
        {#if n.graphNode}
            <p class="text-surface-600-400 pt-1">{maximized ? "Double-click to write here." : "Double-click to go to it in the script."}</p>
        {/if}
    </div>
{/if}

{#if menu}
    <ContextMenu x={menu.x} y={menu.y} keyboard={menu.keyboard} items={menu.items} onclose={() => { menu = null; map?.focus(); }} />
{/if}

{#snippet drawNode(n: StoryMapNode, state: NodeState)}
    <StoryMapNodeBox node={n} {state} />
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
    /* Faded by its box blending into the background, and a dashed outline, not by opacity, which
       would take its label below a readable contrast (#639) */
    .story-map :global(.gm-node.unreachable .gm-node-box) {
        fill: var(--gm-background);
        stroke-dasharray: 4 3;
    }
    .story-map :global(.gm-node.unreachable .gm-node-label) {
        fill: var(--color-surface-700-300);
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

    .name-box {
        position: fixed;
        z-index: 50;
        width: 14rem;
        /* The input, not the label above it, is where the box is */
        transform: translate(-50%, -2.5rem);
    }
    .name-label {
        display: block;
        width: fit-content;
        margin: 0 auto 0.25rem;
        padding: 0.05rem 0.4rem;
        font-size: 0.6875rem;
        line-height: 1.1rem;
        border-radius: 0.25rem;
        color: var(--color-surface-50);
        background-color: var(--color-surface-700);
        user-select: none;
        pointer-events: none;
    }
    .map-details {
        max-width: min(28rem, calc(100% - 1rem));
    }
    .map-excerpt {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 4;
        line-clamp: 4;
        overflow: hidden;
        overflow-wrap: anywhere;
    }
    .map-hover {
        position: fixed;
        z-index: 40;
        width: 18rem;
        padding: 0.5rem 0.75rem;
        font-size: 0.75rem;
        line-height: 1.4;
        border-radius: 0.375rem;
        border: 1px solid var(--color-surface-200-800);
        background-color: var(--color-surface-50-950);
        box-shadow: 0 4px 12px rgb(0 0 0 / 0.15);
        pointer-events: none;
    }
    .map-hover > * + * {
        margin-top: 0.25rem;
    }
    .name-box input {
        background-color: light-dark(white, var(--color-surface-800));
        border: 2px solid var(--color-primary-500);
        border-radius: 6px;
        padding: 0.25rem 0.5rem;
        box-shadow: 0 2px 8px rgb(0 0 0 / 0.2);
    }
    .name-error {
        margin-top: 0.25rem;
        padding: 0.25rem 0.5rem;
        font-size: 0.75rem;
        border-radius: 0.25rem;
        color: var(--color-error-950-50);
        background-color: light-dark(var(--color-error-100), var(--color-error-900));
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
        color: var(--color-primary-600-400);
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
        background-color: var(--color-surface-50-950);
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
