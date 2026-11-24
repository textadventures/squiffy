<script lang="ts">
    // A tab for each open file, with a dot while it has unsaved changes. The main file's tab is
    // marked with a star. Tabs can be dragged into another order, or moved with
    // Ctrl/Cmd+Shift+Left and Right while one has the focus.
    import { basename } from "@textadventures/project-fs";
    import type { OpenProject } from "#lib/project.svelte.js";
    import X from "@lucide/svelte/icons/x";
    import Star from "@lucide/svelte/icons/star";

    let { project }: { project: OpenProject } = $props();

    // A type of our own, so a tab dropped on the code editor or elsewhere doesn't insert anything
    const DRAG_TYPE = "application/x-squiffy-tab";

    // The tab being dragged, and where it would go: before the tab at this index (or at the end)
    let dragging = $state<string | null>(null);
    let dropIndex = $state<number | null>(null);

    function handleDragStart(e: DragEvent, path: string) {
        if (!e.dataTransfer) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(DRAG_TYPE, path);
        dragging = path;
    }

    function handleDragOver(e: DragEvent, index: number) {
        if (!dragging) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        // Before this tab if over its left half, otherwise after it
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        dropIndex = e.clientX < r.left + r.width / 2 ? index : index + 1;
    }

    // Over the empty space after the last tab
    function handleDragOverEnd(e: DragEvent) {
        if (!dragging) return;
        e.preventDefault();
        dropIndex = project.openFiles.length;
    }

    function handleDrop(e: DragEvent) {
        if (!dragging || dropIndex === null) return;
        e.preventDefault();
        project.moveTab(dragging, dropIndex);
        endDrag();
    }

    function endDrag() {
        dragging = null;
        dropIndex = null;
    }

    function handleKeydown(e: KeyboardEvent, path: string, index: number) {
        if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
        e.preventDefault();
        const button = e.currentTarget as HTMLElement;
        project.moveTab(path, e.key === "ArrowLeft" ? index - 1 : index + 2);
        // Moving the element loses the focus, so put it back
        requestAnimationFrame(() => {
            button.focus();
            button.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
    }
</script>

<!-- A group of buttons, the open one marked as current, rather than ARIA tabs: each has a close
     button, which a tablist can't hold, and they're reached with Tab, not the arrow keys (#639) -->
<div
    role="group"
    aria-label="Open files"
    tabindex="-1"
    class="flex items-end overflow-x-auto border-b border-surface-200-800 bg-surface-100-900 shrink-0"
    ondrop={handleDrop}
>
    {#each project.openFiles as file, index (file.path)}
        {@const selected = file.path === project.activePath}
        <div
            role="presentation"
            class="editor-tab group relative flex items-center gap-1 pl-3 pr-1 py-1 text-xs border-r border-surface-200-800 whitespace-nowrap"
            class:editor-tab-selected={selected}
            class:editor-tab-dragging={dragging === file.path}
            class:drop-before={dropIndex === index}
            class:drop-after={dropIndex === index + 1 && index === project.openFiles.length - 1}
            draggable="true"
            ondragstart={e => handleDragStart(e, file.path)}
            ondragover={e => handleDragOver(e, index)}
            ondragend={endDrag}
        >
            <button
                type="button"
                aria-current={selected ? "true" : undefined}
                title={file.path}
                class="flex items-center gap-1"
                onclick={() => { project.activePath = file.path; }}
                onkeydown={e => handleKeydown(e, file.path, index)}
            >
                {#if file.path === project.mainFile}
                    <Star size={11} class="text-warning-700-300" aria-label="Main file" />
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
    <!-- The rest of the strip, so a tab can be dropped at the end -->
    <div class="flex-1 self-stretch min-w-4" role="presentation" ondragover={handleDragOverEnd}></div>
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
    .editor-tab-dragging {
        opacity: 0.5;
    }
    .tab-close:hover {
        background-color: var(--color-surface-200-800);
    }
    /* Where a dragged tab would go */
    .drop-before::before,
    .drop-after::after {
        content: "";
        position: absolute;
        top: 0;
        bottom: 0;
        width: 2px;
        background-color: var(--color-primary-500);
        pointer-events: none;
    }
    .drop-before::before {
        left: -1px;
    }
    .drop-after::after {
        right: -1px;
    }
</style>
