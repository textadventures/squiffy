<script lang="ts" module>
    // The card's Download project button, which the toolbar's Saved chip focuses
    export const BACKUP_CARD_DOWNLOAD_ID = "backup-card-download";
</script>

<script lang="ts">
    // Reminds the author to download a copy of a story kept in the browser, which the browser
    // can clear. A card at the foot of the Files pane, rather than a banner above the editor, so
    // the script never moves when it appears, and the file list above it keeps its place. When
    // the sidebar's hidden (on a phone, or with the map full screen), the Saved chip in the
    // toolbar gets a download icon, which shows the sidebar and this card (Toolbar.svelte).
    // Shown once the story's been changed on two different days, and again a week after a
    // download or Remind me later (needsBackup in backup.ts). The first time it's shown, it asks
    // the browser to keep the site's storage, which may show a prompt (in Firefox).
    import { project } from "#lib/project.svelte.js";
    import { storagePersisted } from "#lib/backup.js";
    import HardDriveDownload from "@lucide/svelte/icons/hard-drive-download";

    interface Props {
        // Downloads the whole project as a zip, which resolves the reminder
        ondownload: () => Promise<void> | void;
    }

    let { ondownload }: Props = $props();

    const p = $derived(project.current);
    const shown = $derived(p?.showBackupReminder ?? false);

    let downloading = $state(false);

    // Asked once per story opened, when the reminder first shows
    let askedFor: unknown = null;
    $effect(() => {
        const current = p;
        if (!shown || !current || current.storagePersisted || askedFor === current) return;
        askedFor = current;
        void storagePersisted(true).then(persisted => { current.storagePersisted = persisted; });
    });

    async function handleDownload() {
        downloading = true;
        try {
            await ondownload();
        } finally {
            downloading = false;
        }
    }
</script>

{#if shown}
    <div role="region" aria-label="Back up this story" class="shrink-0 mx-2 mb-2 p-2.5 rounded border border-surface-200-800 border-l-4 border-l-primary-500 bg-white dark:bg-surface-900 text-xs space-y-2">
        <p class="flex gap-2">
            <HardDriveDownload size={14} class="shrink-0 mt-px text-primary-600-400" />
            <span>This story is only kept in this browser, which can clear it. Download a copy to keep it safe.</span>
        </p>
        <div class="flex flex-wrap gap-1.5 justify-end">
            <button type="button" class="btn btn-xs preset-tonal" onclick={() => void p?.resolveBackupReminder()}>Remind me later</button>
            <button type="button" id={BACKUP_CARD_DOWNLOAD_ID} class="btn btn-xs preset-filled-primary-500" onclick={handleDownload} disabled={downloading}>
                {downloading ? "Downloading…" : "Download project"}
            </button>
        </div>
    </div>
{/if}
