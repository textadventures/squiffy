<script lang="ts">
    // Home: start a new story, open one, or carry on with a draft kept in this browser. In the
    // desktop app there are no drafts: stories are folders on disk.
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";
    import { base } from "#lib/base-path.js";
    import {
        canOpenFolders, deleteDraft, forgetFolder, importFile, isDesktop, listDrafts, listRecentFolders, newDraft, openFolder,
        openRecentFolder, draftFromText, pickDesktopFile, pickDesktopFolder, pickDesktopNewStory, pickDesktopRecent,
        type DraftMeta, type RecentFolder,
    } from "#lib/project.svelte.js";
    import { openInEditor } from "#lib/desktop-shell.js";
    import { desktopApi } from "#lib/desktop.js";
    import { DOCS_URL } from "#lib/links.js";
    import type { StoredProject } from "@textadventures/project-fs";
    import { clearLegacyAutoSave, getLegacyAutoSave, type LegacyAutoSave } from "#lib/legacy.js";
    import { confirmDialog } from "#lib/confirm.js";
    import { showToast } from "#lib/toast.js";
    import { checkDraftStorage } from "#lib/storage.js";
    import HomeHeader from "#components/HomeHeader.svelte";
    import BetaBanner from "#components/BetaBanner.svelte";

    // The banner points beta users at the current version. The first stable desktop app is 7.0.0,
    // so until then Squiffy Beta has nothing to point at, and doesn't show it.
    const showBetaBanner = import.meta.env.VITE_BETA_APP === "true" && !(isDesktop && __APP_VERSION__.startsWith("7.0.0-"));
    import FilePlus from "@lucide/svelte/icons/file-plus";
    import FolderOpen from "@lucide/svelte/icons/folder-open";
    import FileUp from "@lucide/svelte/icons/file-up";
    import Trash2 from "@lucide/svelte/icons/trash-2";
    import X from "@lucide/svelte/icons/x";
    import ShieldAlert from "@lucide/svelte/icons/shield-alert";

    let draftList = $state<StoredProject<DraftMeta>[] | null>(null);
    let recentFolders = $state<RecentFolder[]>([]);
    // Unsaved work from the 6.x editor, if there is any
    let legacy = $state<LegacyAutoSave | null>(null);
    let draftsError = $state<string | null>(null);
    // Set when the browser won't let the editor use OPFS, where drafts are kept
    let storageBlocked = $state<string | null>(null);
    let busy = $state(false);
    let fileInput = $state<HTMLInputElement>();

    async function refresh() {
        if (canOpenFolders) recentFolders = await listRecentFolders();
        if (isDesktop) return;
        const storage = await checkDraftStorage();
        if (!storage.ok) {
            storageBlocked = storage.detail;
            return;
        }
        try {
            draftList = await listDrafts();
        } catch (err) {
            draftsError = err instanceof Error ? err.message : String(err);
        }
    }

    onMount(() => {
        void refresh();
        if (isDesktop) return desktopApi()?.desktop.recent.onChanged(() => void refresh());
        void getLegacyAutoSave().then(saved => { legacy = saved; });
    });

    const handleOpenLegacy = () => run(async () => {
        if (!legacy) return;
        const id = await draftFromText(legacy.fileName, legacy.content);
        await clearLegacyAutoSave();
        legacy = null;
        await editDraft(id);
    });

    async function handleDiscardLegacy() {
        if (!(await confirmDialog("Discard this unsaved work from the previous editor? This can't be undone.", { confirmLabel: "Discard", danger: true }))) return;
        await clearLegacyAutoSave();
        legacy = null;
    }

    async function run(action: () => Promise<void>) {
        if (busy) return;
        busy = true;
        try {
            await action();
        } catch (err) {
            showToast(err instanceof Error ? err.message : String(err));
        } finally {
            busy = false;
        }
    }

    const editDraft = (id: string) => goto(`${base}/edit?draft=${encodeURIComponent(id)}`);

    const handleNew = () => isDesktop ? openInEditor(pickDesktopNewStory) : run(async () => editDraft(await newDraft()));

    const editFolder = (id: string) => goto(`${base}/edit?folder=${encodeURIComponent(id)}`);

    const handleOpenFolder = () => isDesktop ? openInEditor(pickDesktopFolder) : run(async () => {
        const id = await openFolder();
        if (id) await editFolder(id);
    });

    // The click is what lets the browser ask for permission to the folder again
    const handleOpenRecent = (folder: RecentFolder) => isDesktop
        ? openInEditor(() => pickDesktopRecent(folder.id), `Couldn't open ${folder.name}. It may have been moved or deleted.`)
        : run(async () => {
            if (await openRecentFolder(folder.id, true)) await editFolder(folder.id);
            else showToast(`Couldn't open ${folder.name}. The browser may not have been given permission, or the folder has moved.`, "info");
        });

    async function handleForget(folder: RecentFolder) {
        await forgetFolder(folder.id);
        await refresh();
    }

    function handleFileChosen(e: Event) {
        const input = e.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        input.value = "";
        if (file) void run(async () => editDraft(await importFile(file)));
    }

    async function handleDelete(draft: StoredProject<DraftMeta>) {
        const name = draft.meta?.title || draft.meta?.mainFile || "this draft";
        if (!(await confirmDialog(`Delete ${name}? This can't be undone.`, { confirmLabel: "Delete", danger: true }))) return;
        await run(async () => {
            await deleteDraft(draft.id);
            await refresh();
        });
    }

    const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
</script>

{#if showBetaBanner}
    <BetaBanner />
{/if}
<HomeHeader />

<main class="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-8">
    {#if storageBlocked}
        <section aria-labelledby="storage-heading" role="alert" class="card preset-outlined-error-500 p-4 flex gap-3">
            <ShieldAlert size={22} class="shrink-0 text-error-500" />
            <div class="flex flex-col gap-1 text-sm">
                <h2 id="storage-heading" class="font-semibold">This browser is blocking the storage the editor needs</h2>
                <p>
                    The editor keeps stories in your browser's storage, and the browser won't let it.
                    A privacy add-on, a strict privacy setting (such as blocking all cookies), or a private window can cause this.
                    Try allowing this site in the add-on or settings and reloading, or use another browser.
                </p>
                {#if canOpenFolders}
                    <p>You can still use Open folder to work on a story's folder on your computer.</p>
                {/if}
                <p class="text-xs text-surface-600-400">Details: {storageBlocked}</p>
            </div>
        </section>
    {/if}

    {#if legacy}
        <section aria-labelledby="legacy-heading" class="card preset-outlined-warning-500 p-4 flex flex-wrap items-center gap-3">
            <div class="flex-1 basis-64">
                <h2 id="legacy-heading" class="font-semibold text-sm">Unsaved work from the previous editor</h2>
                <p class="text-xs text-surface-600-400">
                    {legacy.title || legacy.fileName || "Untitled"} · Last changed {dateFormat.format(legacy.timestamp)}
                </p>
            </div>
            <button type="button" class="btn btn-sm preset-filled-primary-500" disabled={busy || !!storageBlocked} onclick={handleOpenLegacy}>Open as a draft</button>
            <button type="button" class="btn btn-sm preset-tonal" disabled={busy} onclick={handleDiscardLegacy}>Discard</button>
        </section>
    {/if}

    <section aria-labelledby="start-heading" class="flex flex-col gap-3">
        <h2 id="start-heading" class="text-sm font-semibold text-surface-600-400 uppercase tracking-wide">Start</h2>
        <div class="grid gap-3 sm:grid-cols-3">
            <button type="button" class="card start-card preset-outlined-surface-200-800" disabled={busy || !!storageBlocked} onclick={handleNew}>
                <FilePlus size={22} class="text-primary-500" />
                <span class="font-medium">New story</span>
                <span class="text-xs text-surface-600-400">{isDesktop ? "In a folder you choose" : "Kept in this browser as a draft"}</span>
            </button>
            {#if canOpenFolders}
                <button type="button" class="card start-card preset-outlined-surface-200-800" disabled={busy} onclick={handleOpenFolder}>
                    <FolderOpen size={22} class="text-primary-500" />
                    <span class="font-medium">Open folder</span>
                    <span class="text-xs text-surface-600-400">A story's folder on your computer</span>
                </button>
            {/if}
            <button type="button" class="card start-card preset-outlined-surface-200-800" disabled={busy || !!storageBlocked} onclick={() => isDesktop ? openInEditor(pickDesktopFile) : fileInput?.click()}>
                <FileUp size={22} class="text-primary-500" />
                <span class="font-medium">Open file</span>
                <span class="text-xs text-surface-600-400">
                    {isDesktop ? "A .squiffy file, or a project .zip to unpack into a folder" : "Copy a .squiffy file, or a project .zip, into a new draft"}
                </span>
            </button>
            <input bind:this={fileInput} type="file" accept=".squiffy,.zip" class="hidden" onchange={handleFileChosen} />
        </div>
        {#if !isDesktop}
            <p class="text-xs text-surface-600-400">
                Squiffy is also a <a class="anchor" href="{DOCS_URL}/desktop-app/" target="_blank" rel="noopener noreferrer">desktop app</a>
                for Mac, Windows and Linux, which keeps stories in folders on your computer.
            </p>
        {/if}
        {#if !canOpenFolders}
            <p class="text-xs text-surface-600-400">
                This browser can't open folders on your computer, so stories are kept in the browser. Use File, Download project
                in the editor to keep a copy, and Open file to bring it back.
            </p>
        {/if}
    </section>

    {#if recentFolders.length > 0}
        <section aria-labelledby="recent-heading" class="flex flex-col gap-3">
            <h2 id="recent-heading" class="text-sm font-semibold text-surface-600-400 uppercase tracking-wide">Recent folders</h2>
            <ul class="card preset-outlined-surface-200-800 divide-y divide-surface-200-800">
                {#each recentFolders as folder (folder.id)}
                    <li class="flex items-center gap-2 pr-2">
                        <button type="button" class="draft-row flex-1 min-w-0 text-left px-4 py-2.5 flex items-center gap-3" disabled={busy} onclick={() => handleOpenRecent(folder)}>
                            <FolderOpen size={16} class="shrink-0 text-surface-600-400" />
                            <span class="flex flex-col min-w-0">
                                <span class="font-medium truncate">{folder.name}</span>
                                <span class="text-xs text-surface-600-400 truncate" title={folder.displayPath}>
                                    {folder.displayPath ?? folder.mainFile} · Last opened {dateFormat.format(folder.lastOpened)}
                                </span>
                            </span>
                        </button>
                        <button
                            type="button"
                            class="btn-icon btn-icon-sm"
                            title="Remove from this list"
                            aria-label="Remove {folder.name} from recent folders"
                            disabled={busy}
                            onclick={() => handleForget(folder)}
                        ><X size={15} /></button>
                    </li>
                {/each}
            </ul>
        </section>
    {/if}

    {#if !isDesktop}
        <section aria-labelledby="drafts-heading" class="flex flex-col gap-3">
            <h2 id="drafts-heading" class="text-sm font-semibold text-surface-600-400 uppercase tracking-wide">Drafts</h2>
            {#if storageBlocked}
                <p class="text-sm text-surface-600-400">Drafts can't be kept while the browser is blocking storage.</p>
            {:else if draftsError}
                <p class="text-sm text-error-500">Drafts aren't available in this browser: {draftsError}</p>
            {:else if draftList === null}
                <p class="text-sm text-surface-600-400">Loading…</p>
            {:else if draftList.length === 0}
                <p class="text-sm text-surface-600-400">No drafts yet.</p>
            {:else}
                <ul class="card preset-outlined-surface-200-800 divide-y divide-surface-200-800">
                    {#each draftList as draft (draft.id)}
                        <li class="flex items-center gap-2 pr-2">
                            <button type="button" class="draft-row flex-1 min-w-0 text-left px-4 py-2.5 flex flex-col" disabled={busy} onclick={() => run(() => editDraft(draft.id))}>
                                <span class="font-medium truncate">{draft.meta?.title || draft.meta?.mainFile || "Untitled"}</span>
                                {#if draft.meta?.lastOpened}
                                    <span class="text-xs text-surface-600-400">Last opened {dateFormat.format(draft.meta.lastOpened)}</span>
                                {/if}
                            </button>
                            <button
                                type="button"
                                class="btn-icon btn-icon-sm hover:preset-tonal-error"
                                title="Delete draft"
                                aria-label="Delete {draft.meta?.title || "draft"}"
                                disabled={busy}
                                onclick={() => handleDelete(draft)}
                            ><Trash2 size={15} /></button>
                        </li>
                    {/each}
                </ul>
            {/if}
        </section>
    {/if}
</main>

<style>
    .start-card {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.35rem;
        padding: 1rem;
        text-align: left;
    }
    .start-card:hover:not(:disabled),
    .draft-row:hover:not(:disabled) {
        background-color: var(--color-surface-100-900);
    }
</style>
