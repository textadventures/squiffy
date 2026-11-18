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
    }

    let { problems, counts, onselect, onfix, onclose }: Props = $props();

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

<section aria-label="Problems" class="flex flex-col max-h-[30vh] border-t border-surface-200-800 bg-surface-50-950">
    <header class="flex items-center gap-2 px-3 py-1.5 border-b border-surface-200-800">
        <h2 class="text-xs font-semibold">Problems</h2>
        <span class="text-xs text-surface-600-400 flex-1 truncate" role="status">{problems.length ? summary : "None"}</span>
        <button type="button" class="btn-icon btn-icon-sm" aria-label="Close problems" title="Close" onclick={onclose}><X size={14} /></button>
    </header>
    {#if problems.length === 0}
        <p class="px-3 py-2 text-xs text-surface-600-400">No problems in the story.</p>
    {:else}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <ul bind:this={list} class="overflow-y-auto text-xs" onkeydown={handleKeydown}>
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
