<script lang="ts">
    // The project's files (#118), as a tree. Text files open in a tab; anything else (images and
    // other assets, #73) is managed from the Assets dialog. Each file's ⋯ menu renames, deletes,
    // downloads it, or makes a .squiffy file the main one.
    import { basename, dirname } from "@textadventures/project-fs";
    import type { OpenProject } from "#lib/project.svelte.js";
    import { isTextFile } from "#lib/file-types.js";
    import DropdownMenu from "#components/DropdownMenu.svelte";
    import type { DropdownMenuItem } from "#components/DropdownMenu.svelte";
    import FileText from "@lucide/svelte/icons/file-text";
    import FileImage from "@lucide/svelte/icons/file-image";
    import Folder from "@lucide/svelte/icons/folder";
    import Star from "@lucide/svelte/icons/star";
    import Plus from "@lucide/svelte/icons/plus";
    import Ellipsis from "@lucide/svelte/icons/ellipsis";

    interface Props {
        project: OpenProject;
        onnewfile: () => void;
        onrename: (path: string) => void;
        ondelete: (path: string) => void;
        ondownload: (path: string) => void;
        // Opens a text file, or shows an asset
        onopen: (path: string) => void;
    }

    let { project, onnewfile, onrename, ondelete, ondownload, onopen }: Props = $props();

    // The files, with a row for each folder before its contents
    type Row = { kind: "folder"; path: string; depth: number } | { kind: "file"; path: string; depth: number };
    let rows = $derived.by(() => {
        const out: Row[] = [];
        const shown = new Set<string>();
        for (const { path } of project.files) {
            const parts = path.split("/");
            for (let i = 1; i < parts.length; i++) {
                const folder = parts.slice(0, i).join("/");
                if (!shown.has(folder)) {
                    shown.add(folder);
                    out.push({ kind: "folder", path: folder, depth: i - 1 });
                }
            }
            out.push({ kind: "file", path, depth: parts.length - 1 });
        }
        return out;
    });

    function menuItems(path: string): DropdownMenuItem[] {
        const items: DropdownMenuItem[] = [
            { label: "Rename", action: () => onrename(path) },
            { label: "Download", action: () => ondownload(path) },
        ];
        if (path.toLowerCase().endsWith(".squiffy") && path !== project.mainFile) {
            items.push({ label: "Make this the main file", action: () => project.setMainFile(path) });
        }
        items.push({ label: "Delete", action: () => ondelete(path), divider: true });
        return items;
    }
</script>

<section aria-label="Files" class="flex flex-col min-h-0">
    <div class="flex items-center pl-3 pr-1 pt-2 pb-1">
        <h2 class="flex-1 text-[11px] font-semibold text-surface-600-400 uppercase tracking-wide">Files</h2>
        <button type="button" class="btn-icon btn-icon-sm" title="New file" aria-label="New file" onclick={onnewfile}><Plus size={14} /></button>
    </div>
    <ul class="overflow-y-auto pb-2 text-sm">
        {#each rows as row (row.kind + row.path)}
            <li>
                {#if row.kind === "folder"}
                    <div class="flex items-center gap-1.5 py-0.5 pr-2 text-surface-600-400" style="padding-left: {0.75 + row.depth}rem">
                        <Folder size={13} class="shrink-0 opacity-60" />
                        <span class="truncate">{basename(row.path)}</span>
                    </div>
                {:else}
                    {@const text = isTextFile(row.path)}
                    <div class="file-row group flex items-center" class:file-row-active={row.path === project.activePath}>
                        <button
                            type="button"
                            class="flex-1 min-w-0 flex items-center gap-1.5 py-0.5 text-left"
                            style="padding-left: {0.75 + row.depth}rem"
                            title={row.path}
                            onclick={() => onopen(row.path)}
                        >
                            {#if text}
                                <FileText size={13} class="shrink-0 opacity-60" />
                            {:else}
                                <FileImage size={13} class="shrink-0 opacity-60" />
                            {/if}
                            <span class="truncate" class:text-surface-600-400={!text}>{basename(row.path)}</span>
                            {#if row.path === project.mainFile}
                                <Star size={11} class="shrink-0 text-warning-500" aria-label="Main file" />
                            {/if}
                        </button>
                        <DropdownMenu items={menuItems(row.path)} fixed>
                            {#snippet trigger(toggle, open)}
                                <button
                                    type="button"
                                    class="inline-flex items-center justify-center size-6 rounded opacity-0 group-hover:opacity-100 focus:opacity-100"
                                    class:opacity-100={open}
                                    title="More"
                                    aria-label="More actions for {basename(row.path)}"
                                    aria-haspopup="menu"
                                    aria-expanded={open}
                                    onclick={toggle}
                                ><Ellipsis size={14} /></button>
                            {/snippet}
                        </DropdownMenu>
                    </div>
                {/if}
            </li>
        {/each}
    </ul>
</section>

<style>
    .file-row:hover {
        background-color: var(--color-surface-100-900);
    }
    .file-row-active {
        background-color: var(--color-surface-200-800);
    }
</style>
