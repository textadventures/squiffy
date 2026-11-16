<script lang="ts">
    // Says when a new version of the editor is ready, as the 6.x editor does. Reload saves first.
    // A card at the bottom left, clear of the toasts, so it never covers the editor's toolbar.
    import { update, applyUpdate } from "#lib/updates.svelte.js";
    import { project } from "#lib/project.svelte.js";

    let dismissed = $state(false);

    async function reload() {
        await project.current?.save();
        applyUpdate();
    }
</script>

{#if update.waiting && !dismissed}
    <div role="status" class="fixed bottom-4 left-4 z-[60] max-w-sm flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 rounded-lg shadow-lg bg-surface-50-950 border border-surface-200-800 text-sm">
        <span class="flex-1">A new version of Squiffy is ready.</span>
        <button type="button" class="btn btn-xs preset-filled-primary-500" onclick={reload}>Reload</button>
        <button type="button" class="btn btn-xs preset-tonal" onclick={() => { dismissed = true; }}>Later</button>
    </div>
{/if}
