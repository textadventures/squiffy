<script lang="ts">
    // A tab for each open file, with a dot while it has unsaved changes. The main file's tab is
    // marked with a star.
    import { basename } from "@textadventures/project-fs";
    import type { OpenProject } from "#lib/project.svelte.js";
    import X from "@lucide/svelte/icons/x";
    import Star from "@lucide/svelte/icons/star";

    let { project }: { project: OpenProject } = $props();
</script>

<div role="tablist" aria-label="Open files" class="flex items-end overflow-x-auto border-b border-surface-200-800 bg-surface-100-900 shrink-0">
    {#each project.openFiles as file (file.path)}
        {@const selected = file.path === project.activePath}
        <div
            class="editor-tab group flex items-center gap-1 pl-3 pr-1 py-1 text-xs border-r border-surface-200-800 whitespace-nowrap"
            class:editor-tab-selected={selected}
        >
            <button
                type="button"
                role="tab"
                aria-selected={selected}
                title={file.path}
                class="flex items-center gap-1"
                onclick={() => { project.activePath = file.path; }}
            >
                {#if file.path === project.mainFile}
                    <Star size={11} class="text-warning-500" aria-label="Main file" />
                {/if}
                {basename(file.path)}
            </button>
            <button
                type="button"
                class="tab-close inline-flex items-center justify-center size-5 rounded"
                title="Close {basename(file.path)}"
                aria-label="Close {basename(file.path)}"
                onclick={() => void project.close(file.path)}
            >
                {#if file.dirty}
                    <span class="size-2 rounded-full bg-current group-hover:hidden" aria-label="Unsaved changes"></span>
                    <X size={12} class="hidden group-hover:block" />
                {:else}
                    <X size={12} />
                {/if}
            </button>
        </div>
    {/each}
</div>

<style>
    .editor-tab {
        color: var(--color-surface-600-400);
    }
    .editor-tab-selected {
        background-color: var(--color-surface-50-950);
        color: var(--color-surface-900-100);
        box-shadow: inset 0 2px 0 var(--color-primary-500);
    }
    .tab-close:hover {
        background-color: var(--color-surface-200-800);
    }
</style>
