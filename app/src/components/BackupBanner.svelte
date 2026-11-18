<script lang="ts">
    // Reminds the author to download a copy of a story kept in the browser, which the browser
    // can clear, as Quest Viva's backup banner does. Shown once the story's been changed, and
    // again a week after a download or Dismiss (needsBackup in project.svelte.ts).
    import { project } from "#lib/project.svelte.js";

    interface Props {
        // Downloads the whole project as a zip, which resolves the reminder
        ondownload: () => Promise<void>;
    }

    let { ondownload }: Props = $props();

    let downloading = $state(false);

    async function handleDownload() {
        downloading = true;
        try {
            await ondownload();
        } finally {
            downloading = false;
        }
    }
</script>

{#if project.current?.showBackupReminder}
    <div role="status" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 bg-primary-100-900 border-b border-primary-300-700 text-sm">
        <span class="flex-1 basis-64">This story is only kept in this browser. Download a copy to keep it safe.</span>
        <button type="button" class="btn btn-xs preset-filled-primary-500" onclick={handleDownload} disabled={downloading}>
            {downloading ? "Downloading…" : "Download project"}
        </button>
        <button type="button" class="btn btn-xs preset-tonal" onclick={() => void project.current?.resolveBackupReminder()}>Dismiss</button>
    </div>
{/if}
