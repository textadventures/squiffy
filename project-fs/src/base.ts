import { ProjectFsError, notFound } from "./errors.js";
import { guessMimeType } from "./mime.js";
import { caseKey, checkSegment, isJunkFile, isSkippedDirectory, parsePath } from "./paths.js";
import type { FileChange, FileEntry, FileUrl, ProjectFileSystem } from "./types.js";

/** One entry of a directory, as a back end reports it. Names are as stored. */
export interface DirEntry {
    name: string;
    kind: "file" | "directory";
}

export interface FileStat {
    size?: number;
    lastModified?: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

/**
 * Shared semantics for adapters over a real directory tree. A subclass supplies a handful of
 * primitives that work on already-validated segment arrays, and this class does everything else:
 * path validation, exact-case lookup, case-conflict checks, recursive listing, pruning empty
 * directories, text encoding and object URLs.
 *
 * Lookups go through readDir() rather than asking the back end for a name directly, because a
 * case-insensitive disk would happily open "Readme.txt" for "README.txt" while OPFS wouldn't.
 * Comparing against the stored names (in NFC, since HFS+ hands back NFD) makes every back end
 * behave like a case-sensitive one. Primitives are then called with the names as stored.
 */
export abstract class TreeFileSystem implements ProjectFileSystem {
    abstract readonly name: string;

    /** Entries of a directory, or null if it doesn't exist (or isn't a directory). */
    protected abstract readDir(dir: string[]): Promise<DirEntry[] | null>;
    protected abstract statFile(path: string[]): Promise<FileStat>;
    protected abstract readFile(path: string[]): Promise<Uint8Array>;
    /** Parent directories exist by the time this is called. */
    protected abstract writeFile(path: string[], data: Uint8Array): Promise<void>;
    protected abstract createDir(path: string[]): Promise<void>;
    protected abstract removeFile(path: string[]): Promise<void>;
    /** Removes an empty directory. */
    protected abstract removeDir(path: string[]): Promise<void>;

    // ── Lookup ──────────────────────────────────────────────────────────────

    /**
     * Resolves segments to their stored names, exact (NFC) match only. Returns the stored path
     * and the kind of the last entry, or null if any segment is missing or a non-final segment
     * is a file.
     */
    protected async lookup(segments: string[]): Promise<{ stored: string[]; kind: "file" | "directory" } | null> {
        const stored: string[] = [];
        let kind: "file" | "directory" = "directory";
        for (const segment of segments) {
            if (kind !== "directory") return null;
            const entries = await this.readDir(stored);
            const match = entries?.find((e) => e.name.normalize("NFC") === segment);
            if (!match) return null;
            stored.push(match.name);
            kind = match.kind;
        }
        return { stored, kind };
    }

    private async resolveFile(path: string): Promise<string[]> {
        const found = await this.lookup(parsePath(path));
        if (!found) throw notFound(path);
        if (found.kind !== "file") throw new ProjectFsError("NOT_A_FILE", `Not a file: ${path}`, path);
        return found.stored;
    }

    // ── ProjectFileSystem ───────────────────────────────────────────────────

    async list(dir = ""): Promise<FileEntry[]> {
        const segments = parsePath(dir, true);
        const found = await this.lookup(segments);
        if (!found) return [];
        if (found.kind !== "directory") throw new ProjectFsError("NOT_A_DIRECTORY", `Not a directory: ${dir}`, dir);
        const out: FileEntry[] = [];
        await this.walk(found.stored, segments, out);
        return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    }

    private async walk(stored: string[], logical: string[], out: FileEntry[]): Promise<void> {
        const entries = (await this.readDir(stored)) ?? [];
        for (const entry of entries) {
            const name = entry.name.normalize("NFC");
            if (!isValidSegment(name)) continue; // e.g. "a:b" on macOS: can't be addressed, so not listed
            if (entry.kind === "directory") {
                if (!isSkippedDirectory(name)) await this.walk([...stored, entry.name], [...logical, name], out);
            } else if (!isJunkFile(name)) {
                const stat = await this.statFile([...stored, entry.name]);
                out.push({ path: [...logical, name].join("/"), ...stat });
            }
        }
    }

    async read(path: string): Promise<Uint8Array> {
        return this.readFile(await this.resolveFile(path));
    }

    async readText(path: string): Promise<string> {
        return decoder.decode(await this.read(path));
    }

    async exists(path: string): Promise<boolean> {
        return (await this.lookup(parsePath(path)))?.kind === "file";
    }

    async write(path: string, data: Uint8Array | string): Promise<void> {
        const segments = parsePath(path);
        const bytes = typeof data === "string" ? encoder.encode(data) : data;
        const stored: string[] = [];
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            const isLast = i === segments.length - 1;
            const entries = (await this.readDir(stored)) ?? [];
            const exact = entries.find((e) => e.name.normalize("NFC") === segment);
            if (exact) {
                const want = isLast ? "file" : "directory";
                if (exact.kind !== want) {
                    const at = [...segments.slice(0, i + 1)].join("/");
                    throw want === "file"
                        ? new ProjectFsError("NOT_A_FILE", `Can't write ${path}: ${at} is a directory`, path)
                        : new ProjectFsError("NOT_A_DIRECTORY", `Can't write ${path}: ${at} is a file`, path);
                }
                stored.push(exact.name);
                continue;
            }
            const clash = entries.find((e) => caseKey(e.name) === caseKey(segment));
            if (clash) {
                const existing = [...segments.slice(0, i), clash.name.normalize("NFC")].join("/");
                throw new ProjectFsError(
                    "CASE_CONFLICT",
                    `Can't write ${path}: it differs only in case from ${existing}`,
                    path,
                );
            }
            stored.push(segment);
            if (!isLast) await this.createDir([...stored]);
        }
        await this.writeFile(stored, bytes);
    }

    async delete(path: string): Promise<void> {
        const stored = await this.resolveFile(path);
        await this.removeFile(stored);
        // Prune directories the delete left empty, so an invisible empty "Assets" folder can't
        // later block writing "assets/..." with a CASE_CONFLICT.
        for (let dir = stored.slice(0, -1); dir.length > 0; dir = dir.slice(0, -1)) {
            const entries = await this.readDir(dir);
            if (!entries || entries.length > 0) break;
            await this.removeDir(dir);
        }
    }

    async url(path: string): Promise<FileUrl> {
        if (typeof URL.createObjectURL !== "function") {
            throw new ProjectFsError("NOT_SUPPORTED", "Object URLs aren't available here");
        }
        return blobUrl(await this.read(path), path);
    }
}

function isValidSegment(name: string): boolean {
    try {
        checkSegment(name);
        return true;
    } catch {
        return false;
    }
}

export function blobUrl(bytes: Uint8Array, path: string): FileUrl {
    const type = guessMimeType(path);
    const url = URL.createObjectURL(new Blob([bytes.slice()], type ? { type } : {}));
    let released = false;
    return {
        url,
        release() {
            if (!released) URL.revokeObjectURL(url);
            released = true;
        },
    };
}

/** A tiny listener registry for watch() implementations. */
export class ChangeEmitter {
    private listeners = new Set<(changes: FileChange[]) => void>();

    get size() {
        return this.listeners.size;
    }

    add(listener: (changes: FileChange[]) => void, onEmpty?: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            if (this.listeners.delete(listener) && this.listeners.size === 0) onEmpty?.();
        };
    }

    emit(changes: FileChange[]): void {
        if (changes.length === 0) return;
        for (const l of [...this.listeners]) l(changes);
    }
}
