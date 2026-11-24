<script lang="ts">
    // Every problem in the story, in all its files, as a panel under the editor (Ctrl/Cmd+Shift+M).
    // Clicking a problem moves the editor there; its quick fixes are buttons beside it, so they
    // don't vanish the way the editor's hover tooltip does when the mouse moves.
    import type { CodeAction } from "squiffy-compiler/language-service";
    import type { Problem, ProblemCounts } from "#lib/problems.js";
    import X from "@lucide/svelte/icons/x";
    import CircleX from "@lucide/svelte/icons/circle-x";
    import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
    import Info from "@lucide/svelte/icons/info";
    import Wrench from "@lucide/svelte/icons/wrench";

    interface Props {
        problems: Problem[];
        counts: ProblemCounts;
        onselect: (problem: Problem) => void;
        onfix: (fix: CodeAction) => void;
        onclose: () => void;
        // The panel's height in pixels, which dragging its top edge changes
        height?: number;
    }

    let { problems, counts, onselect, onfix, onclose, height = $bindable(200) }: Props = $props();

    const MIN_HEIGHT = 60;

    // Drags the top edge to resize the panel, as the editor's other splitters do. It can grow to
    // leave the editor a few lines (the space above it, less 80px).
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

    let list = $state<HTMLUListElement>();

    const LABELS = { error: "Error", warning: "Warning", hint: "Hint" } as const;

    function plural(n: number, word: string) {
        return `${n} ${word}${n === 1 ? "" : "s"}`;
    }

    let summary = $derived.by(() => {
        const parts = [];
        if (counts.error) parts.push(plural(counts.error, "error"));
        if (counts.warning) parts.push(plural(counts.warning, "warning"));
        if (counts.hint) parts.push(plural(counts.hint, "hint"));
        return parts.join(", ");
    });

    // Up and down move between the problems themselves, skipping their fixes
    function handleKeydown(e: KeyboardEvent) {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
        const rows = [...(list?.querySelectorAll<HTMLButtonElement>("button.problem") ?? [])];
        if (!rows.length) return;
        const at = rows.findIndex(r => r.parentElement?.contains(document.activeElement));
        const next = e.key === "Home" ? 0
            : e.key === "End" ? rows.length - 1
            : e.key === "ArrowDown" ? Math.min(rows.length - 1, at + 1)
            : Math.max(0, at - 1);
        e.preventDefault();
        rows[next].focus();
    }

    export function focus() {
        list?.querySelector<HTMLButtonElement>("button.problem")?.focus();
    }
</script>

<section aria-label="Problems" class="relative flex flex-col shrink-0 border-t border-surface-200-800 bg-surface-50-950" style="height: {height}px">
    <div role="separator" aria-orientation="horizontal" aria-label="Resize problems" class="splitter-rows" onpointerdown={handleSplitterPointerDown}></div>
    <header class="flex items-center gap-2 px-3 py-1.5 border-b border-surface-200-800">
        <h2 class="text-xs font-semibold">Problems</h2>
        <span class="text-xs text-surface-600-400 flex-1 truncate" role="status">{problems.length ? summary : "None"}</span>
        <button type="button" class="btn-icon btn-icon-sm" aria-label="Close problems" title="Close" onclick={onclose}><X size={14} /></button>
    </header>
    {#if problems.length === 0}
        <p class="px-3 py-2 text-xs text-surface-600-400">No problems in the story.</p>
    {:else}
        <!-- The keydown moves focus between the problems' buttons with the arrow keys, Home and
             End, as they bubble up from those buttons, which are what keyboard users reach with
             Tab. The list itself isn't a control (#639) -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <ul bind:this={list} class="flex-1 min-h-0 overflow-y-auto text-xs" onkeydown={handleKeydown}>
            {#each problems as problem, i (i)}
                {@const d = problem.diagnostic}
                <li class="row">
                    <button
                        type="button"
                        class="problem w-full text-left flex items-start gap-2 px-3 py-1"
                        onclick={() => onselect(problem)}
                        title="Go to {d.file} line {d.range.start.line + 1}"
                    >
                        <span class="icon icon-{d.severity} shrink-0" aria-label={LABELS[d.severity]} role="img">
                            {#if d.severity === "error"}<CircleX size={14} />{:else if d.severity === "warning"}<TriangleAlert size={14} />{:else}<Info size={14} />{/if}
                        </span>
                        <span class="min-w-0 flex-1">{d.message}</span>
                        <span class="text-surface-600-400 shrink-0 tabular-nums">{d.file}:{d.range.start.line + 1}</span>
                    </button>
                    {#if problem.fixes.length}
                        <div class="flex flex-wrap gap-1 pl-8 pr-3 pb-1.5">
                            {#each problem.fixes as fix (fix.title)}
                                <button type="button" class="btn btn-xs preset-tonal-primary text-xs py-0.5" onclick={() => onfix(fix)}>
                                    <Wrench size={12} /> {fix.title}
                                </button>
                            {/each}
                        </div>
                    {/if}
                </li>
            {/each}
        </ul>
    {/if}
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
    :global(body.splitter-dragging-rows) {
        cursor: row-resize;
        user-select: none;
    }
    :global(body.splitter-dragging-rows iframe) {
        pointer-events: none;
    }
    .row:hover,
    .row:focus-within {
        background-color: var(--color-surface-100-900);
    }
    .icon {
        display: inline-flex;
        padding-top: 0.05rem;
    }
    .icon-error {
        color: var(--color-error-600-400);
    }
    .icon-warning {
        color: var(--color-warning-700-300);
    }
    .icon-hint {
        color: var(--color-primary-600-400);
    }
</style>
