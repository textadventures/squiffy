<svelte:options namespace="svg" />

<script lang="ts" module>
    // A label, shortened to fit its box, leaving room for a marker
    function fit(n: { label: string; width: number }, reserve: number) {
        const chars = Math.max(1, Math.floor((n.width - 14 - reserve) / 6.6));
        return n.label.length > chars ? `${n.label.slice(0, Math.max(1, chars - 1))}…` : n.label;
    }
</script>

<script lang="ts">
    // A box on the story map: a section, a passage, or a marker for a broken link, with the start,
    // endings and problems marked on it. Drawn inside GraphMap's node snippet, whose <g> has its
    // origin at the box's top left. Shared with the VS Code extension's map (vscode/src/map/),
    // which styles these classes with VS Code's theme.
    import type { NodeState } from "@textadventures/graph-map/GraphMap.svelte";
    import type { StoryMapNode } from "#lib/story-map.js";

    let { node: n, state }: { node: StoryMapNode; state: NodeState } = $props();
    const g = $derived(n.graphNode);
</script>

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
