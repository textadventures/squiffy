<svelte:options namespace="svg" />

<script lang="ts" module>
    // How a box with the start of its text is laid out (#681), at each level of detail the map's
    // zoomed in to: 0, then 1, then 2. The more it's zoomed in, the smaller the text can be, and
    // the more of it fits: as many lines as the box's height has room for. A look that's only for
    // a bigger box than usual (which the author can make it) isn't used for one of the usual size,
    // which has room for its name and not much else.
    interface Look {
        // The name's font size, and where its middle is
        labelSize: number;
        labelY: number;
        // The text's font size, and where the first line's middle is
        textSize: number;
        textY: number;
        biggerOnly?: boolean;
    }
    const BIG_SECTION: Look = { labelSize: 12, labelY: 12, textSize: 9, textY: 26, biggerOnly: true };
    const BIG_PASSAGE: Look = { labelSize: 11, labelY: 11, textSize: 8, textY: 24, biggerOnly: true };
    const LOOKS: Record<"section" | "passage", Look[]> = {
        section: [BIG_SECTION, { labelSize: 10, labelY: 10, textSize: 7.5, textY: 21 }, { labelSize: 8.5, labelY: 8.5, textSize: 5.5, textY: 16.5 }],
        passage: [BIG_PASSAGE, BIG_PASSAGE, { labelSize: 7.5, labelY: 7, textSize: 5.5, textY: 15 }],
    };
    // Roughly how wide a character is, and how far apart lines are, for a font size
    const CHAR = 0.55;
    const LINE = 1.3;

    // A label, shortened to fit its box, leaving room for a marker
    function fit(n: { label: string; width: number }, reserve: number, charWidth = 6.6) {
        const chars = Math.max(1, Math.floor((n.width - 14 - reserve) / charWidth));
        return n.label.length > chars ? `${n.label.slice(0, Math.max(1, chars - 1))}…` : n.label;
    }
</script>

<script lang="ts">
    // A box on the story map: a section, a passage, or a marker for a broken link, with the start,
    // endings and problems marked on it. Drawn inside GraphMap's node snippet, whose <g> has its
    // origin at the box's top left. Shared with the VS Code extension's map (vscode/src/map/),
    // which styles these classes with VS Code's theme.
    import type { NodeState } from "@textadventures/graph-map/GraphMap.svelte";
    import { wrapExcerpt, type StoryMapNode } from "#lib/story-map.js";

    // `excerpt` gives the start of the box's text, which it shows under its name when the map's
    // zoomed in (see LOOKS)
    let { node: n, state: nodeState, excerpt }: { node: StoryMapNode; state: NodeState; excerpt?: () => Promise<string> } = $props();
    const g = $derived(n.graphNode);

    const section = $derived(n.kind === "section");
    const look = $derived.by(() => {
        if (n.kind === "missing" || !excerpt) return undefined;
        const l = LOOKS[n.kind][Math.min(nodeState.detail, 2)];
        return l.biggerOnly && !n.size ? undefined : l;
    });
    let text = $state("");
    $effect(() => {
        if (!look || !excerpt) return;
        let current = true;
        void excerpt().then(t => { if (current) text = t; });
        return () => { current = false; };
    });
    // A passage's ends are round, so its text is inset further
    const inset = $derived(section ? 5 : 9);
    const lines = $derived.by(() => {
        if (!look || !text) return [];
        const step = look.textSize * LINE;
        const room = Math.floor((n.height - 3 - look.textSize * 0.7 - look.textY) / step) + 1;
        return wrapExcerpt(text, (n.width - inset * 2) / (look.textSize * CHAR), Math.max(1, room));
    });
    // Drawn with its text, if there's any
    const shown = $derived(lines.length > 0 ? look : undefined);
    // Where the middle of the name and its marker are
    const labelY = $derived(shown?.labelY ?? n.height / 2);
    const labelSize = $derived(shown?.labelSize ?? 12);
    const radius = $derived(section ? 6 : Math.min(n.height / 2, 11));
</script>

<rect class="gm-node-box" width={n.width} height={n.height} rx={radius} />
{#if g?.ending}
    <rect class="ending-inner" x="2.5" y="2.5" width={n.width - 5} height={n.height - 5} rx="4" />
{/if}
{#if shown}
    <text class="gm-node-label detail-label" style:font-size="{labelSize}px" x={n.width / 2 + (g?.start ? 4 : 0)} y={labelY} dy="0.35em" text-anchor="middle">{fit(n, g?.start ? 8 : 0, labelSize * CHAR)}</text>
    <text class="excerpt" font-size={shown.textSize}>
        {#each lines as line, i (i)}
            <tspan x={section ? inset : n.width / 2} text-anchor={section ? "start" : "middle"} y={shown.textY + i * shown.textSize * LINE} dy="0.35em">{line}</tspan>
        {/each}
    </text>
{:else}
    <text class="gm-node-label" x={n.width / 2 + (g?.start ? 5 : 0)} y={labelY} dy="0.35em" text-anchor="middle">{fit(n, g?.start ? 10 : 0)}</text>
{/if}
{#if g?.start}
    {@const r = labelSize * 0.4}
    <path class="start-marker" d="M{shown ? 6 : 7},{labelY - r}l{r * 1.6},{r}l{-r * 1.6},{r}z" />
{/if}
{#if (g?.deadEnd && g.reachable) || n.kind === "missing" || g?.unknownExits}
    <g transform="translate({n.width - 2},2)">
        <circle r="7" class={g?.unknownExits ? "badge-unknown" : "badge-problem"} />
        <text class="badge-text" dy="0.35em" text-anchor="middle">{g?.unknownExits ? "?" : "!"}</text>
    </g>
{/if}
{#if nodeState.selected}
    <rect class="selected-ring" x="-3" y="-3" width={n.width + 6} height={n.height + 6} rx={section ? 8 : radius + 3} />
{/if}

<style>
    /* Its size is set inline, as the map's own styles size a passage's label */
    .detail-label {
        font-weight: 600;
    }
    .excerpt {
        fill: var(--gm-node-text);
        opacity: 0.75;
        pointer-events: none;
    }
</style>
