import { ProjectFsError } from "./errors.js";
import { caseKey } from "./paths.js";
import type { FileEntry, FileTypeFilter, ProjectFileSystem } from "./types.js";

/** Files whose extension matches one of the filters, e.g. to offer a choice of main file. */
export async function findFiles(fs: ProjectFileSystem, filters: FileTypeFilter[], dir = ""): Promise<FileEntry[]> {
    const exts = filters.flatMap((f) => f.extensions.map((e) => e.toLowerCase()));
    return (await fs.list(dir)).filter((f) => exts.some((e) => f.path.toLowerCase().endsWith(e)));
}

/**
 * Copies every file from one project to another, e.g. for Save As (pick a new root, then copy).
 * Refuses to copy into a target that already has files unless `overwrite` is set.
 */
export async function copyProject(
    from: ProjectFileSystem,
    to: ProjectFileSystem,
    options: { overwrite?: boolean } = {},
): Promise<void> {
    if (!options.overwrite && (await to.list()).length > 0) {
        throw new ProjectFsError("IO", `${to.name} isn't empty`);
    }
    for (const f of await from.list()) await to.write(f.path, await from.read(f.path));
}

/**
 * Renames a file within a project (read, write, delete: no back end here has an atomic move).
 * A rename that only changes case goes through a temporary name.
 */
export async function moveFile(fs: ProjectFileSystem, from: string, to: string): Promise<void> {
    if (from === to) return;
    const data = await fs.read(from);
    if (caseKey(from) === caseKey(to)) {
        const tmp = `${to}.${Math.random().toString(36).slice(2)}.tmp`;
        await fs.write(tmp, data);
        await fs.delete(from);
        await fs.write(to, data);
        await fs.delete(tmp);
        return;
    }
    if (await fs.exists(to)) throw new ProjectFsError("IO", `${to} already exists`, to);
    await fs.write(to, data);
    await fs.delete(from);
}
