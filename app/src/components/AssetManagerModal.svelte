<script lang="ts">
    // The story's images, sounds, videos and fonts (#73). From Quest Viva's AssetManagerModal:
    // upload, thumbnails and delete, plus Insert, which puts a reference to the file at the cursor.
    // Assets are ordinary files in the project, beside the main file by default, and a story
    // refers to them by their path from the main file's folder.
    import { onMount } from "svelte";
    import { dirname, joinPath, parsePath, type FileUrl } from "@textadventures/project-fs";
    import { storyPath, type OpenProject } from "#lib/project.svelte.js";
    import { isAsset, isImage } from "#lib/file-types.js";
    import { isBuildPath } from "#lib/file-tree.js";
    import { confirmDialog } from "#lib/confirm.js";
    import { trapFocus } from "#lib/actions/trapFocus.js";
    import FileIcon from "@lucide/svelte/icons/file";

    interface Props {
        project: OpenProject;
        // Inserts a reference to an asset at the cursor, given its path from the main file's folder
        oninsert?: (path: string, image: boolean) => void;
        oncancel: () => void;
    }
    const { project, oninsert, oncancel }: Props = $props();

    // Files added from outside the app (Finder, etc.) only show up after a fresh listing
    onMount(() => { void project.refreshFiles(); });

    // Not the copies the CLI puts in its build folder, which the story doesn't use
    let assets = $derived(project.files.filter(f => isAsset(f.path) && !isBuildPath(f.path)));

    // Thumbnails, released when the dialog closes
    let thumbUrls = $state<Record<string, string>>({});
    const urls = new Map<string, FileUrl>();
    $effect(() => {
        for (const asset of assets) {
            if (!isImage(asset.path) || urls.has(asset.path) || !project.fs.url) continue;
            const path = asset.path;
            urls.set(path, { url: "", release: () => {} });
            void project.fs.url(path).then(u => {
                urls.set(path, u);
                thumbUrls = { ...thumbUrls, [path]: u.url };
            });
        }
    });
    onMount(() => () => { for (const u of urls.values()) u.release(); });

    let inputEl: HTMLInputElement;
    let uploading = $state(false);
    let error = $state("");
    let dialogEl = $state<HTMLDivElement>();
    $effect(() => { dialogEl?.focus(); });

    async function handleUpload(e: Event) {
        const target = e.target as HTMLInputElement;
        const files = [...(target.files ?? [])];
        target.value = "";
        if (!files.length) return;
        uploading = true;
        error = "";
        try {
            for (const file of files) {
                const path = joinPath(dirname(project.mainFile), file.name);
                parsePath(path);
                if (project.files.some(f => f.path === path)
                    && !(await confirmDialog(`Replace ${path}?`, { confirmLabel: "Replace" }))) continue;
                await project.writeFile(path, new Uint8Array(await file.arrayBuffer()));
            }
        } catch (err) {
            error = err instanceof Error ? err.message : String(err);
        } finally {
            uploading = false;
        }
    }

    async function handleDelete(path: string) {
        const ok = await confirmDialog(`Delete ${path}? This can't be undone.`, { confirmLabel: "Delete", danger: true });
        if (!ok) return;
        await project.deleteFile(path);
        urls.get(path)?.release();
        urls.delete(path);
        const rest = { ...thumbUrls };
        delete rest[path];
        thumbUrls = rest;
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") oncancel();
    }
</script>

<div
    bind:this={dialogEl}
    role="dialog"
    aria-modal="true"
    aria-labelledby="assets-title"
    tabindex="-1"
    class="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
    onclick={e => { if (e.target === e.currentTarget) oncancel(); }}
    onkeydown={handleKeydown}
    use:trapFocus
>
    <div class="card bg-surface-50-950 rounded-xl shadow-xl w-full max-w-[32rem] max-h-[85dvh] p-6 flex flex-col gap-4">
        <div class="flex items-center justify-between">
            <h2 id="assets-title" class="text-base font-semibold">Images and other files</h2>
            <button class="btn btn-xs preset-tonal" onclick={oncancel}>Close</button>
        </div>

        <div class="flex items-center gap-2">
            <button
                type="button"
                class="btn btn-xs preset-filled-primary-500"
                onclick={() => inputEl.click()}
                disabled={uploading}
            >{uploading ? "Adding…" : "Add files"}</button>
            <input bind:this={inputEl} type="file" multiple accept="image/*,audio/*,video/*,.woff,.woff2,.ttf,.otf" class="hidden" onchange={handleUpload} />
            {#if error}<p class="text-xs text-error-600-400">{error}</p>{/if}
        </div>

        <div class="flex-1 overflow-y-auto flex flex-col gap-1">
            {#if assets.length === 0}
                <p class="text-xs text-surface-600-400">No images or other files yet. Add some, then use Insert to show one in the story.</p>
            {/if}
            {#each assets as asset (asset.path)}
                <div class="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-surface-100-900">
                    {#if thumbUrls[asset.path]}
                        <img src={thumbUrls[asset.path]} alt="" class="h-8 w-8 object-cover rounded border border-surface-200-800 shrink-0" />
                    {:else}
                        <span class="h-8 w-8 rounded border border-surface-200-800 shrink-0 flex items-center justify-center text-surface-600-400"><FileIcon size={16} /></span>
                    {/if}
                    <span class="text-xs flex-1 truncate" title={asset.path}>{asset.path}</span>
                    {#if oninsert}
                        <button
                            type="button"
                            class="btn btn-xs preset-outlined-primary-500 text-xs px-2 py-0.5"
                            onclick={() => oninsert(storyPath(project, asset.path), isImage(asset.path))}
                        >Insert</button>
                    {/if}
                    <button
                        type="button"
                        class="btn btn-xs preset-outlined-error-500 text-xs px-2 py-0.5"
                        onclick={() => handleDelete(asset.path)}
                    >Delete</button>
                </div>
            {/each}
        </div>
    </div>
</div>
