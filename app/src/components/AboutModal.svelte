<script lang="ts">
    // About Squiffy: the version, as the 6.x editor's About dialog shows.
    import { base } from "#lib/base-path.js";
    import { GITHUB_URL } from "#lib/links.js";
    import { trapFocus } from "#lib/actions/trapFocus.js";

    let { onclose }: { onclose: () => void } = $props();

    let dialogEl = $state<HTMLDivElement>();
    $effect(() => { dialogEl?.focus(); });
</script>

<div
    bind:this={dialogEl}
    role="dialog"
    aria-modal="true"
    aria-labelledby="about-title"
    tabindex="-1"
    class="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
    onclick={e => { if (e.target === e.currentTarget) onclose(); }}
    onkeydown={e => { if (e.key === "Escape") onclose(); }}
    use:trapFocus
>
    <div class="card bg-surface-50-950 rounded-xl shadow-xl w-full max-w-xs p-6 flex flex-col items-center gap-3 text-center">
        <img src="{base}/squiffy.png" alt="" class="h-16" />
        <h2 id="about-title" class="text-lg font-semibold">Squiffy {__APP_VERSION__}</h2>
        <p class="text-sm">
            <a class="anchor" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
            ·
            <a class="anchor" href="{GITHUB_URL}/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a>
        </p>
        <button type="button" class="btn btn-sm preset-tonal" onclick={onclose}>Close</button>
    </div>
</div>
