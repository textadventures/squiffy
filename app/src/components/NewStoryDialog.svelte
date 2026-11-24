<script lang="ts">
    // The desktop app's New story dialog: a name, and where its folder will go (see new-story.ts)
    import { tick } from "svelte";
    import { desktopApi } from "#lib/desktop.js";
    import { folderNameFor, newStoryDialogState, tidyTitle, type NewStory } from "#lib/new-story.js";
    import { trapFocus } from "#lib/actions/trapFocus.js";

    let inputEl = $state<HTMLInputElement>();
    let title = $state("");
    let location = $state("");
    let error = $state<string | null>(null);
    let busy = $state(false);

    const folderName = $derived(folderNameFor(title));
    const separator = desktopApi()?.desktop.platform === "windows" ? "\\" : "/";
    const folderPath = $derived(location && folderName ? `${location.replace(/[\\/]+$/, "")}${separator}${folderName}` : "");

    $effect(() => {
        if (!$newStoryDialogState) return;
        title = "";
        error = null;
        busy = false;
        location = "";
        void desktopApi()?.desktop.newStory.location().then(l => location = l);
        void tick().then(() => inputEl?.focus());
    });

    function close(result: NewStory | null) {
        $newStoryDialogState?.resolve(result);
        newStoryDialogState.set(null);
    }

    async function changeLocation() {
        const api = desktopApi();
        if (!api || busy) return;
        const picked = await api.desktop.newStory.chooseLocation();
        if (picked) {
            location = picked;
            error = null;
        }
        inputEl?.focus();
    }

    async function create() {
        const api = desktopApi();
        if (!api || busy || !folderName) return;
        busy = true;
        error = null;
        try {
            const result = await api.desktop.newStory.create(folderName);
            if (result.ok) {
                close({ root: result.root, title: tidyTitle(title) });
                return;
            }
            error = result.reason === "exists"
                ? `There's already a folder called "${folderName}" there. Choose another name, or another location.`
                : "That name can't be used for a folder. Try another.";
        } catch (err) {
            error = `Couldn't create the folder: ${err instanceof Error ? err.message : String(err)}`;
        }
        busy = false;
        inputEl?.focus();
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape" && !busy) close(null);
        // Enter on a button is that button's
        if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
            e.preventDefault();
            void create();
        }
    }

    function onBackdropClick(e: MouseEvent) {
        if (e.target === e.currentTarget && !busy) close(null);
    }
</script>

{#if $newStoryDialogState}
    <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-story-heading"
        tabindex="-1"
        class="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
        onclick={onBackdropClick}
        onkeydown={handleKeydown}
        use:trapFocus
    >
        <div class="card bg-surface-50-950 rounded-xl shadow-xl w-full max-w-md p-6 flex flex-col gap-4">
            <h2 id="new-story-heading" class="font-semibold">New story</h2>
            <label class="flex flex-col gap-1 text-sm">
                <span>Name</span>
                <input bind:this={inputEl} bind:value={title} class="input text-sm" type="text" placeholder="My story" disabled={busy} />
            </label>
            <div class="text-xs text-surface-600-400 flex flex-col gap-1">
                <span>{folderName ? "It'll be made in a new folder:" : "It'll be made in a new folder in:"}</span>
                <span class="font-mono break-all text-surface-950-50" data-testid="new-story-path">{folderPath || location || "…"}</span>
                <button type="button" class="anchor self-start" onclick={changeLocation} disabled={busy}>Change location…</button>
            </div>
            {#if error}
                <p class="text-sm text-error-600-400" role="alert">{error}</p>
            {/if}
            <div class="flex flex-wrap justify-end gap-2">
                <button type="button" class="btn btn-xs preset-tonal" onclick={() => close(null)} disabled={busy}>Cancel</button>
                <button type="button" class="btn btn-xs preset-filled-primary-500" onclick={create} disabled={busy || !folderName}>Create</button>
            </div>
        </div>
    </div>
{/if}
