<script lang="ts">
    // The story's outline: its sections, with their passages under them, and snippets, from the
    // language service's document symbols. Clicking one moves the editor there. Takes the place of
    // the 6.x editor's section and passage dropdowns (#174).
    import type { DocumentSymbol } from "squiffy-compiler/language-service";
    import BookOpen from "@lucide/svelte/icons/book-open";
    import FileText from "@lucide/svelte/icons/file-text";
    import Hash from "@lucide/svelte/icons/hash";
    import Scissors from "@lucide/svelte/icons/scissors";

    interface Props {
        symbols: DocumentSymbol[];
        // Zero-based line the cursor is on, to highlight the section or passage it's in
        cursorLine: number;
        onselect: (symbol: DocumentSymbol) => void;
        width?: number;
    }

    let { symbols, cursorLine, onselect, width }: Props = $props();

    const contains = (s: DocumentSymbol, line: number) => s.range.start.line <= line && line <= s.range.end.line;

    let items = $derived(symbols.filter(s => s.kind !== "title"));

    // The innermost symbol the cursor is in
    let active = $derived.by(() => {
        for (const s of items) {
            if (!contains(s, cursorLine)) continue;
            return s.children.find(c => contains(c, cursorLine)) ?? s;
        }
        return null;
    });

    function label(s: DocumentSymbol) {
        return s.name || s.detail || "(untitled)";
    }
</script>

<nav
    aria-label="Outline"
    class="flex flex-col shrink-0 overflow-hidden bg-surface-50-950 border-r border-surface-200-800 {width === undefined ? "flex-1" : ""}"
    style={width === undefined ? undefined : `width: ${width}px`}
>
    <div class="px-3 py-2 text-[11px] font-semibold text-surface-600-400 uppercase tracking-wide">Outline</div>
    <ul class="flex-1 overflow-y-auto pb-2 text-sm">
        {#each items as symbol, i (i)}
            <li>
                {@render item(symbol, 0)}
                {#if symbol.children.length > 0}
                    <ul>
                        {#each symbol.children as child, j (j)}
                            <li>{@render item(child, 1)}</li>
                        {/each}
                    </ul>
                {/if}
            </li>
        {:else}
            <li class="px-3 py-1 text-surface-600-400 text-xs">No sections yet.</li>
        {/each}
    </ul>
</nav>

{#snippet item(symbol: DocumentSymbol, depth: number)}
    {@const Icon = symbol.kind === "section" ? BookOpen : symbol.kind === "passage" ? Hash : symbol.kind === "snippet" ? Scissors : FileText}
    <button
        type="button"
        class="outline-item w-full text-left flex items-center gap-1.5 py-1 pr-2 truncate"
        class:outline-item-active={active === symbol}
        style="padding-left: {0.75 + depth}rem"
        title={label(symbol)}
        onclick={() => onselect(symbol)}
    >
        <Icon size={13} class="shrink-0 opacity-60" />
        <span class="truncate" class:italic={!symbol.name}>{label(symbol)}</span>
    </button>
{/snippet}

<style>
    .outline-item:hover {
        background-color: var(--color-surface-100-900);
    }
    .outline-item-active {
        background-color: var(--color-surface-200-800);
    }
</style>
