<script lang="ts">
    // The project's files (#118), as a tree. Text files open in a tab; anything else (images and
    // other assets, #73) is managed from the Assets dialog. Each file's ⋯ menu renames, deletes,
    // downloads it, shows it in Finder (in the desktop app), or makes a .squiffy file the main one. With a squiffy.json (#361), it also
    // leaves a .squiffy file out of the story or puts it back, and excluded files are greyed out.
    import { basename, dirname } from "@textadventures/project-fs";
    import type { OpenProject } from "#lib/project.svelte.js";
    import { PROJECT_FILENAME } from "squiffy-compiler";
    import { isTextFile } from "#lib/file-types.js";
    import { folderReveal } from "#lib/desktop.js";
    import { NEW_FILE_KINDS, type NewFileKind } from "#lib/new-file.js";
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
        // The + menu: a story file, a stylesheet or a script
        onnewfile: (kind: NewFileKind) => void;
        onrename: (path: string) => void;
        ondelete: (path: string) => void;
        ondownload: (path: string) => void;
        onmakemain: (path: string) => void;
        // Leaves a .squiffy file out of the story, or puts it back
        onexclude: (path: string, excluded: boolean) => void;
        // Opens a text file, or shows an asset
        onopen: (path: string) => void;
    }

    let { project, onnewfile, onrename, ondelete, ondownload, onmakemain, onexclude, onopen }: Props = $props();

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

    const newFileItems: DropdownMenuItem[] = (Object.keys(NEW_FILE_KINDS) as NewFileKind[])
        .map(kind => ({ label: NEW_FILE_KINDS[kind].label, action: () => onnewfile(kind) }));

    // In the desktop app, shows a file in Finder, Explorer or the file manager
    const reveal = $derived(folderReveal(project.fs));

    function menuItems(path: string): DropdownMenuItem[] {
        const items: DropdownMenuItem[] = [
            { label: "Rename", action: () => onrename(path) },
            { label: "Download", action: () => ondownload(path) },
        ];
        if (reveal) items.push({ label: reveal.label, action: () => reveal.show(path) });
        if (path.toLowerCase().endsWith(".squiffy") && path !== project.mainFile) {
            items.push({ label: "Make this the main file", action: () => onmakemain(path) });
        }
        // A file in the build folder or an old build isn't listed, as it can't be included
        const story = project.storyFiles;
        if (story?.excluded.includes(path)) {
            items.push({ label: "Include in story", action: () => onexclude(path, false) });
        } else if (story && [...story.included, ...story.stylesheets, ...story.scripts].includes(path)) {
            items.push({ label: "Exclude from story", action: () => onexclude(path, true) });
        }
        items.push({ label: "Delete", action: () => ondelete(path), divider: true });
        return items;
    }
</script>

<section aria-label="Files" class="flex flex-col min-h-0">
    <div class="flex items-center pl-3 pr-1 pt-2 pb-1">
        <h2 class="flex-1 text-[11px] font-semibold text-surface-600-400 uppercase tracking-wide">Files</h2>
        <DropdownMenu items={newFileItems}>
            {#snippet trigger(toggle, open)}
                <button type="button" class="btn-icon btn-icon-sm" title="New file" aria-label="New file" aria-haspopup="menu" aria-expanded={open} onclick={toggle}><Plus size={14} /></button>
            {/snippet}
        </DropdownMenu>
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
                    {@const excluded = project.isExcluded(row.path)}
                    {@const isProjectFile = row.path === PROJECT_FILENAME}
                    <div class="file-row group flex items-center" class:file-row-active={row.path === project.activePath}>
                        <button
                            type="button"
                            class="flex-1 min-w-0 flex items-center gap-1.5 py-0.5 text-left"
                            style="padding-left: {0.75 + row.depth}rem"
                            title={excluded
                                ? `${row.path}: not part of the story (excluded in ${PROJECT_FILENAME})`
                                : isProjectFile ? `${row.path}: the project file, which makes this folder one story` : row.path}
                            class:opacity-50={excluded}
                            onclick={() => onopen(row.path)}
                        >
                            {#if text}
                                <FileText size={13} class="shrink-0 opacity-60" />
                            {:else}
                                <FileImage size={13} class="shrink-0 opacity-60" />
                            {/if}
                            <span class="truncate" class:text-surface-600-400={!text}>{basename(row.path)}</span>
                            {#if excluded}
                                <span class="shrink-0 text-[11px] text-surface-600-400">excluded</span>
                            {:else if isProjectFile}
                                <span class="truncate text-[11px] text-surface-600-400">project file</span>
                            {/if}
                            {#if row.path === project.mainFile}
                                <Star size={11} class="shrink-0 text-warning-700-300" aria-label="Main file" />
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
