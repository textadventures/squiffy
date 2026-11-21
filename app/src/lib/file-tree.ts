// The Files panel's tree (FilesPanel.svelte): a row for each folder before its contents, with
// folders that can be collapsed. The CLI's build folder starts collapsed, as its files are never
// part of the story; every other folder starts open. Which folders the author has opened or
// closed is kept in this browser for each project.
import { BUILD_FOLDER } from "squiffy-compiler";
import type { ProjectSource } from "#lib/project.svelte.js";

export type TreeRow =
    | { kind: "folder"; path: string; depth: number; open: boolean }
    | { kind: "file"; path: string; depth: number };

// The folders the author has opened (true) or closed (false). Others are as defaultOpen says.
export type FolderState = Record<string, boolean>;

// The build folder the CLI writes next to squiffy.json, or anything in it
export const isBuildPath = (path: string) => path == BUILD_FOLDER || path.startsWith(BUILD_FOLDER + "/");

export const defaultOpen = (folder: string) => folder != BUILD_FOLDER;

export const isOpen = (state: FolderState, folder: string) => state[folder] ?? defaultOpen(folder);

// `paths` sorted, as from ProjectFileSystem.list(). The contents of a closed folder, including
// its folders, have no rows.
export function treeRows(paths: Iterable<string>, state: FolderState): TreeRow[] {
    const rows: TreeRow[] = [];
    const shown = new Set<string>();
    for (const path of paths) {
        const parts = path.split("/");
        let hidden = false;
        for (let i = 1; i < parts.length && !hidden; i++) {
            const folder = parts.slice(0, i).join("/");
            const open = isOpen(state, folder);
            if (!shown.has(folder)) {
                shown.add(folder);
                rows.push({ kind: "folder", path: folder, depth: i - 1, open });
            }
            hidden = !open;
        }
        if (!hidden) rows.push({ kind: "file", path, depth: parts.length - 1 });
    }
    return rows;
}

// The folders a file is in, outermost first, so they can be opened when it's shown
export function foldersOf(path: string): string[] {
    const parts = path.split("/");
    return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

const storageKey = (source: ProjectSource) => `squiffy-editor-folders:${source.kind}:${source.id}`;

export function loadFolderState(source: ProjectSource): FolderState {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(source)) ?? "{}");
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
        return Object.fromEntries(Object.entries(parsed).filter(([, open]) => typeof open == "boolean"));
    } catch {
        return {};
    }
}

export function saveFolderState(source: ProjectSource, state: FolderState) {
    try {
        // Only what differs from the default is kept
        const changed = Object.entries(state).filter(([folder, open]) => open != defaultOpen(folder));
        if (changed.length) localStorage.setItem(storageKey(source), JSON.stringify(Object.fromEntries(changed)));
        else localStorage.removeItem(storageKey(source));
    } catch {
        // Not kept: folders are as they were by default next time
    }
}
