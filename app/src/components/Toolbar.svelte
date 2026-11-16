<script lang="ts">
    // The editor's toolbar, laid out like Quest Viva's: home, the story's name and save state on
    // the left; actions and the overflow menu on the right.
    import { AppBar } from "@skeletonlabs/skeleton-svelte";
    import { goto } from "$app/navigation";
    import { base } from "#lib/base-path.js";
    import { project, closeProject, downloadFile } from "#lib/project.svelte.js";
    import { settings } from "#lib/settings.svelte.js";
    import { isNarrow } from "#lib/layout.svelte.js";
    import { DOCS_URL, GITHUB_URL } from "#lib/links.js";
    import DropdownMenu from "#components/DropdownMenu.svelte";
    import type { DropdownMenuItem } from "#components/DropdownMenu.svelte";
    import Home from "@lucide/svelte/icons/home";
    import Save from "@lucide/svelte/icons/save";
    import Download from "@lucide/svelte/icons/download";
    import ChevronDown from "@lucide/svelte/icons/chevron-down";
    import Check from "@lucide/svelte/icons/check";
    import LoaderCircle from "@lucide/svelte/icons/loader-circle";
    import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
    import Circle from "@lucide/svelte/icons/circle";
    import Ellipsis from "@lucide/svelte/icons/ellipsis";
    import ListTree from "@lucide/svelte/icons/list-tree";
    import SettingsIcon from "@lucide/svelte/icons/settings";
    import BookOpen from "@lucide/svelte/icons/book-open";
    import Play from "@lucide/svelte/icons/play";
    import ImageIcon from "@lucide/svelte/icons/image";
    import StepForward from "@lucide/svelte/icons/step-forward";
    import GithubIcon from "#components/GithubIcon.svelte";

    interface Props {
        // On a narrow screen, whether the outline is showing instead of the editor
        outlineOpen?: boolean;
        ontoggleoutline?: () => void;
        // Runs the story in the preview, from the start or from the section the cursor is in
        onrun?: (fromCursor: boolean) => void;
        // Opens the Assets dialog
        onassets?: () => void;
    }

    let { outlineOpen = false, ontoggleoutline, onrun, onassets }: Props = $props();

    const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
    const mod = isMac ? "⌘" : "Ctrl+";

    let runMenuItems = $derived<DropdownMenuItem[]>([
        { label: `Run from the start (${mod}Enter)`, action: () => onrun?.(false), icon: Play },
        { label: `Run from this section (${mod}Shift+Enter)`, action: () => onrun?.(true), icon: StepForward },
    ]);

    const p = $derived(project.current);

    function openLink(url: string) {
        window.open(url, "_blank", "noopener,noreferrer");
    }

    async function handleHome() {
        await closeProject();
        void goto(`${base}/`);
    }

    let fileMenuItems = $derived<DropdownMenuItem[]>([
        { label: "Save", action: () => void p?.save(), icon: Save },
        { label: `Download ${p?.activePath ?? ""}`, action: () => { if (p?.activePath) void downloadFile(p.activePath); }, icon: Download, disabled: !p?.activePath },
    ]);

    let overflowItems = $derived.by((): DropdownMenuItem[] => {
        const links: DropdownMenuItem[] = [
            { label: "Documentation", action: () => openLink(DOCS_URL), icon: BookOpen },
            { label: "GitHub", action: () => openLink(GITHUB_URL), icon: GithubIcon },
            { label: "Settings", action: () => { settings.open = true; }, icon: SettingsIcon },
        ];
        if (!isNarrow.current) return links;
        links[0] = { ...links[0], divider: true };
        return [...fileMenuItems, { label: "Images and other files", action: () => onassets?.(), icon: ImageIcon }, ...links];
    });
</script>

<AppBar>
    <AppBar.Toolbar class="grid-cols-[auto_1fr_auto]">
        <AppBar.Lead class="flex-1 min-w-0">
            <div class="flex items-center min-w-0">
                <button
                    type="button"
                    class="toolbar-icon-btn mr-2 shrink-0"
                    onclick={handleHome}
                    title="Back to home"
                    aria-label="Back to home"
                ><Home size={16} /></button>
                {#if p}
                    <span class="text-sm font-medium truncate min-w-0" title={p.source.kind === "folder" ? p.fs.name : p.mainFile}>{p.displayName}</span>
                    {#if p.source.kind === "draft"}
                        <span class="badge preset-tonal text-[11px] ml-2 shrink-0" title="Kept in this browser. Download it to keep a copy.">Draft</span>
                    {/if}
                    <span role="status" aria-live="polite" class="contents">
                        {#if p.saveError}
                            <button
                                type="button"
                                class="save-chip save-chip-error shrink-0"
                                onclick={() => p.save()}
                                title={p.saveError}
                            ><TriangleAlert size={13} /> <span class="hidden md:inline">Save failed. Retry</span></button>
                        {:else if p.saving}
                            <span class="save-chip save-chip-saving shrink-0"><LoaderCircle size={13} class="animate-spin" /> <span class="hidden md:inline">Saving</span></span>
                        {:else if p.dirty}
                            <button
                                type="button"
                                class="save-chip save-chip-unsaved shrink-0"
                                onclick={() => p.save()}
                                title="Save now"
                            ><Circle size={8} fill="currentColor" /> <span class="hidden md:inline">Unsaved</span></button>
                        {:else}
                            <span class="save-chip save-chip-saved shrink-0"><Check size={13} /> <span class="hidden md:inline">Saved</span></span>
                        {/if}
                    </span>
                {/if}
            </div>
        </AppBar.Lead>
        <AppBar.Trail>
            <div class="flex gap-1.5 items-center">
                {#if isNarrow.current}
                    <button
                        type="button"
                        class="toolbar-icon-btn"
                        onclick={ontoggleoutline}
                        title="Outline"
                        aria-label="Outline"
                        aria-pressed={outlineOpen}
                    ><ListTree size={16} /></button>
                {:else}
                    <button type="button" class="toolbar-icon-btn" onclick={onassets} title="Images and other files" aria-label="Images and other files"><ImageIcon size={16} /></button>
                    <DropdownMenu items={fileMenuItems}>
                        {#snippet trigger(toggle, open)}
                            <button
                                type="button"
                                class="btn btn-xs preset-outlined-primary-500"
                                onclick={toggle}
                                title="File"
                                aria-haspopup="menu"
                                aria-expanded={open}
                            >File <ChevronDown size={12} /></button>
                        {/snippet}
                    </DropdownMenu>
                {/if}
                <div class="flex items-center">
                    <button
                        type="button"
                        class="btn btn-xs preset-filled-primary-500 rounded-r-none"
                        onclick={() => onrun?.(false)}
                        title="Run the story ({mod}Enter)"
                    ><Play size={14} /> <span class="hidden md:inline">Run</span></button>
                    <DropdownMenu items={runMenuItems}>
                        {#snippet trigger(toggle, open)}
                            <button
                                type="button"
                                class="btn btn-xs preset-filled-primary-500 rounded-l-none border-l border-primary-700 px-1.5"
                                onclick={toggle}
                                title="Run options"
                                aria-label="Run options"
                                aria-haspopup="menu"
                                aria-expanded={open}
                            ><ChevronDown size={12} /></button>
                        {/snippet}
                    </DropdownMenu>
                </div>
                <DropdownMenu items={overflowItems}>
                    {#snippet trigger(toggle, open)}
                        <button type="button" class="toolbar-icon-btn" onclick={toggle} title="More" aria-label="More" aria-haspopup="menu" aria-expanded={open}><Ellipsis size={16} /></button>
                    {/snippet}
                </DropdownMenu>
            </div>
        </AppBar.Trail>
    </AppBar.Toolbar>
</AppBar>

<style>
    .toolbar-icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border-radius: var(--radius-container);
        color: var(--color-surface-600-400);
    }
    .toolbar-icon-btn:hover:not(:disabled),
    .toolbar-icon-btn[aria-pressed="true"] {
        background-color: var(--color-surface-200-800);
        color: var(--color-primary-500);
    }
    .toolbar-icon-btn:disabled {
        opacity: 0.4;
    }
    .save-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        margin-left: 0.75rem;
        padding: 0.15rem 0.55rem 0.15rem 0.45rem;
        border: none;
        border-radius: 999px;
        font: inherit;
        font-size: 0.75rem;
        font-weight: 600;
        line-height: 1.4;
        white-space: nowrap;
    }
    .save-chip-saved,
    .save-chip-saving,
    .save-chip-unsaved {
        min-width: 6.25rem;
        justify-content: center;
    }
    @media (max-width: 767px) {
        .save-chip-saved,
        .save-chip-saving,
        .save-chip-unsaved {
            min-width: 0;
        }
    }
    .save-chip-saved {
        color: var(--color-success-600-400);
        background-color: color-mix(in srgb, var(--color-success-500) 12%, transparent);
    }
    .save-chip-saving {
        color: var(--color-surface-600-400);
    }
    .save-chip-unsaved {
        color: var(--color-warning-600-400);
        background-color: color-mix(in srgb, var(--color-warning-500) 12%, transparent);
        cursor: pointer;
    }
    .save-chip-unsaved:hover {
        text-decoration: underline;
    }
    .save-chip-error {
        color: var(--color-error-500);
        background-color: color-mix(in srgb, var(--color-error-500) 12%, transparent);
        cursor: pointer;
    }
    .save-chip-error:hover {
        text-decoration: underline;
    }
</style>
