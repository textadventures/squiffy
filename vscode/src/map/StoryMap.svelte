<script lang="ts">
    // The story map in VS Code (#615): the editor's map (app/src/components/MapPanel.svelte), drawn
    // by @textadventures/graph-map from the language server's story graph, in a webview. Clicking
    // a box goes to it in the editor, the cursor's section is highlighted, and dragging from a box
    // to another adds a link, which the extension makes as an edit. Coloured by VS Code's theme.
    import { untrack } from "svelte";
    import type { MapPositions } from "squiffy-compiler";
    import type { StoryGraph } from "squiffy-compiler/language-service";
    import type { GraphNode } from "squiffy-compiler/language-service";
    import GraphMap, { type NodeState } from "@textadventures/graph-map/GraphMap.svelte";
    import StoryMapNodeBox from "@textadventures/squiffy-app/StoryMapNode.svelte";
    import { buildStoryMap, linkTo, pinnedPositions, storyMapLayout, type StoryMapEdge, type StoryMapNode } from "@textadventures/squiffy-app/story-map";
    import type { FromMap, ToMap } from "./messages.js";
    import Menu, { type MenuItem } from "./Menu.svelte";

    let { post }: { post: (message: FromMap) => void } = $props();

    // Above this, the map is slow to lay out, so it asks first, as the editor's does
    const LARGE = 6000;

    let graph = $state.raw<StoryGraph | null>(null);
    let positions = $state.raw<MapPositions | undefined>(undefined);
    let current = $state<string | null>(null);
    let selected = $state<string | null>(null);
    let showLarge = $state(false);
    let map = $state<ReturnType<typeof GraphMap<StoryMapNode, StoryMapEdge>>>();
    const layout = storyMapLayout();

    const base = $derived(graph ? buildStoryMap(graph) : null);
    const pinned = $derived(pinnedPositions(positions, graph));
    const tooLarge = $derived(!!base && base.nodes.length > LARGE && !showLarge);

    // The map's graph, with the cursor's section or passage marked
    const decorated = $derived.by(() => {
        if (!base) return null;
        if (!current) return base;
        return { nodes: base.nodes.map(n => n.id == current ? { ...n, class: `${n.class} current` } : n), edges: base.edges };
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
        }
    }

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

    function canConnect(from: StoryMapNode, to: StoryMapNode | null) {
        // A link to empty space would make a new section, which the editor's map does, but this
        // one doesn't yet
        if (!from.graphNode || !to?.graphNode) return false;
        return "text" in linkTo(from.graphNode, to.graphNode);
    }

    function activate(node: StoryMapNode, how: "click" | "open") {
        // A broken link's marker goes to the link
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
    let menu = $state<{ x: number; y: number; keyboard: boolean; items: MenuItem[] } | null>(null);

    function showMenu(node: StoryMapNode | null, _at: unknown, screen: { x: number; y: number }, keyboard: boolean) {
        const g = node?.graphNode;
        let items: MenuItem[];
        if (node?.kind == "missing") {
            items = [{ label: "Show the link in the script", shortcut: "Enter", action: () => activate(node, "open") }];
        } else if (node && g) {
            const id = g.id;
            items = [
                { label: "Show in the script", shortcut: "Enter", action: () => activate(node, "open") },
                { label: "Rename…", shortcut: "F2", disabled: !!g.detail, action: () => post({ type: "rename", id }) },
                { label: "Add a passage…", action: () => post({ type: "addPassage", id }) },
                { label: "Run from here", divider: true, action: () => post({ type: "run", id }) },
                ...(g.kind == "section" ? [{ label: "Start the story here", disabled: !!g.start || !!g.detail || g.name == "", action: () => post({ type: "start", id }) }] : []),
                { label: "Delete…", shortcut: "Del", divider: true, disabled: !canDelete(g), action: () => post({ type: "delete", ids: [id] }) },
            ];
        } else {
            items = [
                { label: "Zoom in", shortcut: "+", action: () => map?.zoomBy(1.25) },
                { label: "Zoom out", shortcut: "-", action: () => map?.zoomBy(0.8) },
                { label: "Show the whole story", shortcut: "0", action: () => map?.fit() },
            ];
        }
        menu = { ...screen, keyboard, items };
    }

    // The menu key, or Shift+F10, opens the menu for the selected box. In VS Code's webview,
    // they don't make a contextmenu event of their own, as they do in a browser, so the map's
    // keyboard menu gets one here.
    function menuKey(e: KeyboardEvent) {
        if (!(e.key == "ContextMenu" || (e.key == "F10" && e.shiftKey)) || e.altKey || e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        e.target?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 0 }));
    }

    const instructions = "Arrow keys move between sections and passages, and Enter goes to one in the editor. F2 renames it and Delete deletes it. The menu key, or Shift and F10, opens a menu for it. Plus and minus zoom, and 0 fits the whole story in view. Drag the background to pan, a box to move it, or the dot under the selected box to another box to add a link. Shift and drag the background to select several boxes, or Shift and click one, then drag one of them to move them all.";
</script>

<main class="story-map">
    <div class="toolbar" role="toolbar" aria-label="Story map">
        <button type="button" title="Zoom in (+)" aria-label="Zoom in" onclick={() => map?.zoomBy(1.25)}>+</button>
        <button type="button" title="Zoom out (-)" aria-label="Zoom out" onclick={() => map?.zoomBy(0.8)}>−</button>
        <button type="button" title="Show the whole story (0)" aria-label="Show the whole story" onclick={() => map?.fit()}>Fit</button>
    </div>
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
                onmove={moves => post({ type: "move", moves: moves.flatMap(({ node, at }) => node.graphNode ? [{ id: node.graphNode.id, at }] : []) })}
                onconnect={(from, to) => {
                    if (from.graphNode && to?.graphNode) post({ type: "link", from: from.graphNode.id, to: to.graphNode.id });
                }}
                node={drawNode}
            />
            {#if decorated.nodes.length === 0}
                <p class="message overlay">No sections yet.</p>
            {/if}
        {/if}
    </div>
</main>

<svelte:window onkeydown={menuKey} />

{#if menu}
    <Menu x={menu.x} y={menu.y} keyboard={menu.keyboard} items={menu.items} onclose={() => { menu = null; map?.focus(); }} />
{/if}

{#snippet drawNode(n: StoryMapNode, state: NodeState)}
    <StoryMapNodeBox node={n} {state} />
{/snippet}
