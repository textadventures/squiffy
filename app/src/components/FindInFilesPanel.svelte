<script lang="ts">
    // Find in Files (Ctrl/Cmd+Shift+F), as a panel under the editor, like the Problems panel:
    // a search of every text file in the project, with the matches listed by file. Clicking one
    // moves the editor there. The page does the searching, as the text changes.
    import type { SearchSpec, TextMatch } from "@textadventures/editor-search";
    import { excerpt, summary, type FindResults } from "#lib/find-in-files.js";
    import X from "@lucide/svelte/icons/x";
    import CaseSensitive from "@lucide/svelte/icons/case-sensitive";
    import WholeWord from "@lucide/svelte/icons/whole-word";
    import Regex from "@lucide/svelte/icons/regex";

    interface Props {
        spec: SearchSpec;
        // Null before there's anything to search for
        results: FindResults | null;
        // The search isn't a regular expression that parses
        invalid?: boolean;
        onselect: (file: string, match: TextMatch) => void;
        onclose: () => void;
        // The panel's height in pixels, which dragging its top edge changes
        height?: number;
    }

    let { spec = $bindable(), results, invalid = false, onselect, onclose, height = $bindable(240) }: Props = $props();

    const MIN_HEIGHT = 80;

    // Drags the top edge to resize the panel, as the Problems panel's does
    function handleSplitterPointerDown(e: PointerEvent) {
        if (e.button !== 0) return;
        e.preventDefault();
        const splitter = e.currentTarget as HTMLElement;
        const panel = splitter.parentElement!;
        const container = panel.parentElement!;
        const startY = e.clientY;
        const startHeight = panel.getBoundingClientRect().height;
        const max = Math.max(MIN_HEIGHT, startHeight + panel.getBoundingClientRect().top - container.getBoundingClientRect().top - 80);
        splitter.setPointerCapture(e.pointerId);
        document.body.classList.add("splitter-dragging-rows");

        function onMove(moveEvent: PointerEvent) {
            height = Math.round(Math.min(max, Math.max(MIN_HEIGHT, startHeight + startY - moveEvent.clientY)));
        }
        function onUp() {
            splitter.removeEventListener("pointermove", onMove);
            splitter.removeEventListener("pointerup", onUp);
            splitter.removeEventListener("pointercancel", onUp);
            document.body.classList.remove("splitter-dragging-rows");
        }
        splitter.addEventListener("pointermove", onMove);
        splitter.addEventListener("pointerup", onUp);
        splitter.addEventListener("pointercancel", onUp);
    }

    let input = $state<HTMLInputElement>();
    let list = $state<HTMLDivElement>();

    const none = $derived(invalid || (!!spec.search && results !== null && results.total === 0));
    const status = $derived(invalid ? "Invalid pattern" : results ? summary(results) : "");

    const matchRows = () => [...(list?.querySelectorAll<HTMLButtonElement>("button.match") ?? [])];

    // Down from the search box goes into the results; Escape closes the panel
    function handleInputKeydown(e: KeyboardEvent) {
        if (e.key === "ArrowDown" || e.key === "Enter") {
            const first = matchRows()[0];
            if (!first) return;
            e.preventDefault();
            first.focus();
        } else if (e.key === "Escape") {
            e.preventDefault();
            onclose();
        }
    }

    // Up and down move between the matches, and up from the first goes back to the search box
    function handleListKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.preventDefault();
            onclose();
            return;
        }
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
        const rows = matchRows();
        if (!rows.length) return;
        const at = rows.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        if (e.key === "ArrowUp" && at <= 0) {
            input?.focus();
            return;
        }
        const next = e.key === "Home" ? 0
            : e.key === "End" ? rows.length - 1
            : e.key === "ArrowDown" ? Math.min(rows.length - 1, at + 1)
            : at - 1;
        rows[next].focus();
    }

    // Puts the cursor in the search box, with its text selected
    export function focus() {
        input?.focus();
        input?.select();
    }
</script>

<section aria-label="Find in files" class="relative flex flex-col shrink-0 border-t border-surface-200-800 bg-surface-50-950" style="height: {height}px">
    <div role="separator" aria-orientation="horizontal" aria-label="Resize find in files" class="splitter-rows" onpointerdown={handleSplitterPointerDown}></div>
    <header class="flex items-center gap-2 px-3 py-1.5 border-b border-surface-200-800 bg-surface-100-900">
        <h2 class="text-xs font-semibold shrink-0">Find in files</h2>
        <div class="field" class:none role="search">
            <input
                bind:this={input}
                bind:value={spec.search}
                type="text"
                placeholder="Find in every file"
                aria-label="Find in every file"
                autocomplete="off"
                spellcheck="false"
                onkeydown={handleInputKeydown}
            />
            <button type="button" class="toggle" title="Match case" aria-label="Match case" aria-pressed={!!spec.caseSensitive} onclick={() => (spec.caseSensitive = !spec.caseSensitive)}>
                <CaseSensitive size={16} />
            </button>
            <button type="button" class="toggle" title="Match whole word" aria-label="Match whole word" aria-pressed={!!spec.wholeWord} onclick={() => (spec.wholeWord = !spec.wholeWord)}>
                <WholeWord size={16} />
            </button>
            <button type="button" class="toggle" title="Use regular expression" aria-label="Use regular expression" aria-pressed={!!spec.regexp} onclick={() => (spec.regexp = !spec.regexp)}>
                <Regex size={16} />
            </button>
        </div>
        <span class="text-xs text-surface-600-400 flex-1 truncate tabular-nums" role="status">{status}</span>
        <button type="button" class="btn-icon btn-icon-sm" aria-label="Close find in files" title="Close" onclick={onclose}><X size={14} /></button>
    </header>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div bind:this={list} class="flex-1 min-h-0 overflow-y-auto text-xs" onkeydown={handleListKeydown}>
        {#if results}
            {#each results.files as result (result.file)}
                <section aria-label={result.file}>
                    <h3 class="file flex items-center gap-2 px-3 py-1 font-semibold">
                        <span class="truncate">{result.file}</span>
                        <span class="count">{result.matches.length}</span>
                    </h3>
                    <ul>
                        {#each result.matches as match, i (i)}
                            {@const e = excerpt(match)}
                            <li>
                                <button
                                    type="button"
                                    class="match w-full text-left flex gap-3 pl-5 pr-3 py-0.5"
                                    onclick={() => onselect(result.file, match)}
                                    title="Go to {result.file} line {match.line + 1}"
                                >
                                    <span class="line text-surface-600-400 shrink-0 tabular-nums text-right">{match.line + 1}</span>
                                    <span class="font-mono truncate">{e.before}<mark>{e.match}</mark>{e.after}</span>
                                </button>
                            </li>
                        {/each}
                    </ul>
                </section>
            {/each}
            {#if results.capped}
                <p class="px-3 py-2 text-surface-600-400">Only the first {results.total} results are shown.</p>
            {/if}
        {/if}
    </div>
</section>

<style>
    .splitter-rows {
        position: absolute;
        top: -0.2rem;
        left: 0;
        right: 0;
        height: 0.4rem;
        z-index: 10;
        cursor: row-resize;
        transition: background-color 150ms;
    }
    .splitter-rows:hover {
        background-color: color-mix(in srgb, var(--color-primary-500) 50%, transparent);
    }
    .splitter-rows:active {
        background-color: color-mix(in srgb, var(--color-primary-500) 70%, transparent);
    }
    /* The Find panel's field (@textadventures/editor-search), in the app's own markup */
    .field {
        display: flex;
        align-items: center;
        gap: 2px;
        flex: 0 1 22rem;
        min-width: 8rem;
        height: 28px;
        padding: 0 3px 0 8px;
        border: 1px solid var(--color-surface-300-700);
        border-radius: 6px;
        background-color: var(--color-surface-50-950);
        font-size: 13px;
    }
    .field:focus-within {
        border-color: var(--color-primary-500);
        box-shadow: 0 0 0 1px var(--color-primary-500);
    }
    .field.none {
        border-color: var(--color-error-500);
        box-shadow: 0 0 0 1px var(--color-error-500);
    }
    .field input {
        flex: 1;
        min-width: 0;
        height: 100%;
        padding: 0;
        border: none;
        outline: none;
        box-shadow: none;
        background: none;
        font: inherit;
    }
    .field input::placeholder {
        color: var(--color-surface-600-400);
    }
    .toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        width: 24px;
        height: 22px;
        border-radius: 4px;
        color: var(--color-surface-600-400);
    }
    .toggle:hover {
        background-color: color-mix(in srgb, currentColor 12%, transparent);
    }
    .toggle[aria-pressed="true"] {
        background-color: var(--color-primary-500);
        color: var(--color-primary-contrast-500);
    }
    .toggle:focus-visible {
        outline: 2px solid var(--color-primary-500);
        outline-offset: 1px;
    }
    .file {
        position: sticky;
        top: 0;
        background-color: var(--color-surface-50-950);
    }
    .count {
        padding: 0 0.4rem;
        border-radius: 999px;
        background-color: var(--color-surface-200-800);
        color: var(--color-surface-700-300);
        font-weight: normal;
        font-variant-numeric: tabular-nums;
    }
    .line {
        min-width: 2.5em;
    }
    .match:hover,
    .match:focus-visible {
        background-color: var(--color-surface-100-900);
        outline: none;
    }
    .match:focus-visible {
        box-shadow: inset 2px 0 0 var(--color-primary-500);
    }
    /* As a match is in the editor (codemirror-theme.ts) */
    mark {
        background-color: color-mix(in srgb, var(--color-warning-500) 35%, transparent);
        color: inherit;
        border-radius: 2px;
    }
</style>
