<script lang="ts">
    // The story's outline: its sections, with their passages under them, and snippets, from the
    // language service's document symbols. Clicking one moves the editor there. The search box
    // (Ctrl/Cmd+Shift+O) filters it, and Enter goes to the first match. Takes the place of the 6.x
    // editor's section and passage dropdowns (#174).
    import type { DocumentSymbol } from "squiffy-compiler/language-service";
    import BookOpen from "@lucide/svelte/icons/book-open";
    import FileText from "@lucide/svelte/icons/file-text";
    import Hash from "@lucide/svelte/icons/hash";
    import Scissors from "@lucide/svelte/icons/scissors";
    import Search from "@lucide/svelte/icons/search";

    interface Props {
        symbols: DocumentSymbol[];
        // Zero-based line the cursor is on, to highlight the section or passage it's in
        cursorLine: number;
        onselect: (symbol: DocumentSymbol) => void;
        width?: number;
    }

    let { symbols, cursorLine, onselect, width }: Props = $props();

    const contains = (s: DocumentSymbol, line: number) => s.range.start.line <= line && line <= s.range.end.line;

    let query = $state("");
    let searchEl = $state<HTMLInputElement>();

    export function focusSearch() {
        searchEl?.focus();
        searchEl?.select();
    }

    const matches = (s: DocumentSymbol, q: string) => label(s).toLowerCase().includes(q);

    // Sections that match, with all their passages; otherwise sections with matching passages,
    // showing just those
    let items = $derived.by(() => {
        const all = symbols.filter(s => s.kind !== "title");
        const q = query.trim().toLowerCase();
        if (!q) return all;
        return all.flatMap(s => {
            if (matches(s, q)) return [s];
            const children = s.children.filter(c => matches(c, q));
            return children.length ? [{ ...s, children }] : [];
        });
    });

    function first(): DocumentSymbol | undefined {
        const q = query.trim().toLowerCase();
        for (const s of items) {
            if (!q || matches(s, q)) return s;
            if (s.children.length) return s.children[0];
        }
        return undefined;
    }

    function handleSearchKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            e.preventDefault();
            const target = first();
            if (target) {
                query = "";
                onselect(target);
            }
        } else if (e.key === "Escape") {
            query = "";
        }
    }

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
    class="flex flex-col min-h-0 overflow-hidden {width === undefined ? "flex-1" : "shrink-0"}"
    style={width === undefined ? undefined : `width: ${width}px`}
>
    <div class="px-3 pt-2 pb-1 text-[11px] font-semibold text-surface-600-400 uppercase tracking-wide">Outline</div>
    <div class="px-2 pb-2">
        <div class="relative">
            <Search size={13} class="absolute left-2 top-1/2 -translate-y-1/2 opacity-50 pointer-events-none" />
            <input
                bind:this={searchEl}
                bind:value={query}
                type="search"
                class="input text-xs py-1 pl-7"
                placeholder="Go to section or passage"
                aria-label="Go to section or passage"
                onkeydown={handleSearchKeydown}
            />
        </div>
    </div>
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
            <li class="px-3 py-1 text-surface-600-400 text-xs">{query.trim() ? "Nothing matches." : "No sections yet."}</li>
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
