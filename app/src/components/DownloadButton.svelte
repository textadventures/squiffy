<script lang="ts">
    // The home header's Desktop app button, with a dropdown of the installers: the one for this
    // system first, then the others, then the release page. From Quest Viva's DownloadButton.svelte
    // (its compact form). Until GitHub answers, or if it can't be reached, the dropdown has just the
    // link to the releases page.
    import { onMount } from "svelte";
    import DownloadIcon from "@lucide/svelte/icons/download";
    import { fetchDownloadLinks, type DownloadLinks } from "#lib/download-links.js";

    let links = $state<DownloadLinks | null>(null);
    let expanded = $state(false);

    const versionLine = $derived(
        links?.version ? (links.releaseDate ? `${links.version} · released ${links.releaseDate}` : links.version) : null,
    );

    onMount(async () => {
        links = await fetchDownloadLinks();
    });

    $effect(() => {
        if (!expanded) return;
        function onOutside(e: MouseEvent) {
            if (!(e.target as HTMLElement).closest(".download-dropdown")) expanded = false;
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") expanded = false;
        }
        document.addEventListener("mousedown", onOutside);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onOutside);
            document.removeEventListener("keydown", onKey);
        };
    });
</script>

{#if links}
    <div class="download-dropdown relative">
        <button
            type="button"
            class="btn btn-sm preset-outlined-primary-500 gap-1"
            onclick={() => (expanded = !expanded)}
            title={links.primary ? `${links.primary.label} (the desktop app)` : "Download the desktop app"}
            aria-label="Download the desktop app"
            aria-expanded={expanded}
        >
            <DownloadIcon size={14} />
            Desktop app
        </button>
        {#if expanded}
            <div class="absolute right-0 top-full z-[999] mt-1 w-60 bg-surface-50-950 border border-surface-200-800 rounded shadow-lg py-2 flex flex-col items-stretch gap-1 text-surface-900-100">
                {#if versionLine}
                    <p class="text-surface-600-400 text-xs px-3">{versionLine}</p>
                {/if}
                {#if links.primary}
                    <a href={links.primary.url} class="px-3 py-1 text-sm font-medium hover:bg-surface-200-800">{links.primary.label}</a>
                {/if}
                {#each links.others as other (other.url)}
                    <a href={other.url} class="px-3 py-1 text-sm hover:bg-surface-200-800">{other.label}</a>
                {/each}
                <a href={links.releasePage} target="_blank" rel="noopener noreferrer" class="px-3 py-1 text-sm hover:bg-surface-200-800">
                    All downloads and release notes
                </a>
            </div>
        {/if}
    </div>
{/if}
