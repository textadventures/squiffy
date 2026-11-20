// What to do when another program (an AI agent, a text editor, git) changes or deletes a file
// that's open in the editor. It's decided from three texts: what the editor shows, what it last
// saved or read (the editor's last known version of the file), and what's on disk now.
//
//   - The disk still has the last known version: nothing to do.
//   - No unsaved changes: reload, as VS Code does, so working beside an agent just works.
//   - Unsaved changes, and the disk now has the same text: they're saved after all.
//   - Unsaved changes, and the disk has something else: a conflict. Autosave stops for the file
//     until the author picks which to keep.
//   - Deleted: autosave stops, rather than putting the file back.
import { isProjectFsError, type ProjectFileSystem } from "@textadventures/project-fs";

export type DiskAction =
    | { kind: "none" }
    | { kind: "reload"; text: string }
    | { kind: "saved"; text: string }
    | { kind: "conflict"; text: string }
    | { kind: "deleted" };

// `disk` is the file's text on disk, or null if it's gone
export function reconcile(text: string, savedText: string, disk: string | null): DiskAction {
    if (disk === null) return { kind: "deleted" };
    if (disk === savedText) return { kind: "none" };
    if (text === savedText) return { kind: "reload", text: disk };
    if (text === disk) return { kind: "saved", text: disk };
    return { kind: "conflict", text: disk };
}

// The file's text on disk, null if it's gone, or undefined if it can't be read just now (so
// there's nothing to go on)
export async function readDisk(fs: ProjectFileSystem, path: string): Promise<string | null | undefined> {
    try {
        return await fs.readText(path);
    } catch (err) {
        return isProjectFsError(err, "NOT_FOUND") ? null : undefined;
    }
}

// The paths whose entries differ between two listings of a project: added, removed, or (where
// the file system says when files were last modified) changed
export function changedPaths(before: { path: string; lastModified?: number }[], after: { path: string; lastModified?: number }[]): string[] {
    const old = new Map(before.map(f => [f.path, f.lastModified]));
    const changed: string[] = [];
    for (const f of after) {
        if (!old.has(f.path) || old.get(f.path) !== f.lastModified) changed.push(f.path);
        old.delete(f.path);
    }
    return [...changed, ...old.keys()];
}
