<script lang="ts">
    // Above a file's editor when it's been changed outside the editor while it had unsaved
    // changes, or deleted, so it isn't being saved until the author says which to keep
    // (disk-changes.ts)
    import type { OpenFile } from "#lib/project.svelte.js";

    let { file, onclose }: { file: OpenFile; onclose: () => void } = $props();
</script>

{#if file.conflict !== null}
    <div role="alert" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 bg-warning-100-900 border-b border-warning-300-700 text-sm">
        <span class="flex-1 basis-64">This file has been changed outside the editor. Your changes here aren't saved.</span>
        <button type="button" class="btn btn-xs preset-filled-warning-500" onclick={() => file.reload()}>Use the changed file</button>
        <button type="button" class="btn btn-xs preset-tonal" onclick={() => void file.keepMine()}>Keep my changes</button>
    </div>
{:else if file.deleted}
    <div role="alert" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 bg-warning-100-900 border-b border-warning-300-700 text-sm">
        <span class="flex-1 basis-64">
            This file has been deleted outside the editor.{file.dirty ? " Your changes here aren't saved." : ""}
        </span>
        <button type="button" class="btn btn-xs preset-filled-warning-500" onclick={onclose}>Close it</button>
        <button type="button" class="btn btn-xs preset-tonal" onclick={() => void file.keepMine()}>Save it again</button>
    </div>
{/if}
