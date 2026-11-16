import { promises as fsp, watch as fsWatch, type FSWatcher, type Stats } from "node:fs";
import * as nodePath from "node:path";
import { ChangeEmitter, TreeFileSystem, type DirEntry, type FileStat } from "./base.js";
import { ProjectFsError, notFound } from "./errors.js";
import { isJunkFile, parsePath } from "./paths.js";
import type { FileChange } from "./types.js";

function code(err: unknown): string | undefined {
    return (err as NodeJS.ErrnoException)?.code;
}

export function isInside(root: string, candidate: string): boolean {
    const rel = nodePath.relative(root, candidate);
    return rel === "" || (!rel.startsWith("..") && !nodePath.isAbsolute(rel));
}

const WATCH_DEBOUNCE_MS = 150;

/**
 * A project rooted at a directory on disk, through Node's fs. The Electron main process serves
 * each approved root with one of these. Later it could replace the CLI's own file access.
 *
 * Every path is validated by parsePath() and then, before any fs call, resolved through
 * realpath() and checked against the root's realpath, so neither "..", nor a symlink (even a
 * dangling one), can lead outside the root. Symlinked directories aren't followed at all, and
 * symlinked files are only visible when they point inside the root.
 */
export class NodeFileSystem extends TreeFileSystem {
    readonly name: string;
    private realRoot: string | undefined;
    private readonly emitter = new ChangeEmitter();
    private watcher: FSWatcher | null = null;
    // Signatures (mtime:size, or "deleted") of this instance's own last write to each path, so
    // the watcher can tell them from external changes.
    private readonly ownWrites = new Map<string, string>();
    // How many writes or deletes of each path this instance has in progress. The watcher can see
    // a write's events before ownWrites has its signature (or while the file is half written),
    // so it holds off on these paths until the write is recorded.
    private readonly ownBusy = new Map<string, number>();
    private pendingPaths = new Set<string>();
    private debounce: ReturnType<typeof setTimeout> | null = null;

    /** `root` must be an absolute path to an existing directory. */
    constructor(readonly root: string) {
        super();
        if (!nodePath.isAbsolute(root)) throw new ProjectFsError("INVALID_PATH", `Root must be absolute: ${root}`);
        this.name = nodePath.basename(root);
    }

    private async rootReal(): Promise<string> {
        if (this.realRoot === undefined) {
            const real = await fsp.realpath(this.root);
            if (!(await fsp.stat(real)).isDirectory()) throw new ProjectFsError("NOT_A_DIRECTORY", `Not a directory: ${this.root}`);
            this.realRoot = real;
        }
        return this.realRoot;
    }

    /**
     * The absolute path for segments, after checking that the deepest part of it that exists
     * resolves (through any symlinks) to somewhere inside the root.
     */
    private async abs(segments: string[]): Promise<string> {
        for (const s of segments) parsePath(s); // defence in depth: primitives only get validated segments
        const root = await this.rootReal();
        const target = nodePath.join(root, ...segments);
        if (!isInside(root, target)) throw new ProjectFsError("OUTSIDE_ROOT", "Path is outside the project");
        for (let p = target; ; p = nodePath.dirname(p)) {
            let exists = true;
            try {
                await fsp.lstat(p);
            } catch (err) {
                if (code(err) !== "ENOENT") throw err;
                exists = false;
            }
            if (exists) {
                let real: string;
                try {
                    real = await fsp.realpath(p);
                } catch {
                    // A dangling symlink: writing through it would create its target, wherever that is.
                    throw new ProjectFsError("OUTSIDE_ROOT", "Path goes through a broken symlink");
                }
                if (!isInside(root, real)) throw new ProjectFsError("OUTSIDE_ROOT", "Path resolves outside the project");
                return target;
            }
            if (p === root) return target;
        }
    }

    /** Kind of a directory entry, following a symlink only if it's a file inside the root. */
    private async entryKind(dir: string, name: string, isSymlink: boolean, isDir: boolean): Promise<DirEntry["kind"] | null> {
        if (!isSymlink) return isDir ? "directory" : "file";
        try {
            const real = await fsp.realpath(nodePath.join(dir, name));
            if (!isInside(await this.rootReal(), real)) return null;
            return (await fsp.stat(real)).isFile() ? "file" : null;
        } catch {
            return null;
        }
    }

    protected async readDir(segments: string[]): Promise<DirEntry[] | null> {
        let dir: string;
        try {
            dir = await this.abs(segments);
        } catch (err) {
            if (err instanceof ProjectFsError && err.code === "OUTSIDE_ROOT") return null;
            throw err;
        }
        // A symlinked directory isn't followed, even if it points inside the root.
        if (segments.length > 0) {
            try {
                if ((await fsp.lstat(dir)).isSymbolicLink()) return null;
            } catch {
                return null;
            }
        }
        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch (err) {
            if (code(err) === "ENOENT" || code(err) === "ENOTDIR") return null;
            throw err;
        }
        const out: DirEntry[] = [];
        for (const e of entries) {
            if (!e.isFile() && !e.isDirectory() && !e.isSymbolicLink()) continue; // sockets, FIFOs, devices
            const kind = await this.entryKind(dir, e.name, e.isSymbolicLink(), e.isDirectory());
            if (kind) out.push({ name: e.name, kind });
        }
        return out;
    }

    protected async statFile(segments: string[]): Promise<FileStat> {
        const s = await fsp.stat(await this.abs(segments));
        return { size: s.size, lastModified: Math.floor(s.mtimeMs) };
    }

    protected async readFile(segments: string[]): Promise<Uint8Array> {
        try {
            return new Uint8Array(await fsp.readFile(await this.abs(segments)));
        } catch (err) {
            if (code(err) === "ENOENT") throw notFound(segments.join("/"));
            throw err;
        }
    }

    protected async writeFile(segments: string[], data: Uint8Array): Promise<void> {
        const p = await this.abs(segments);
        await this.ownOperation(segments.join("/"), async () => {
            await fsp.writeFile(p, data);
            return fsp.stat(p).catch(() => null);
        });
    }

    protected async createDir(segments: string[]): Promise<void> {
        await fsp.mkdir(await this.abs(segments));
    }

    protected async removeFile(segments: string[]): Promise<void> {
        const p = await this.abs(segments);
        await this.ownOperation(segments.join("/"), async () => {
            await fsp.unlink(p);
            return null;
        });
    }

    protected async removeDir(segments: string[]): Promise<void> {
        await fsp.rmdir(await this.abs(segments));
    }

    // ── watch ───────────────────────────────────────────────────────────────

    /** Runs a write or delete of `path`, then records the resulting file's signature as our own. */
    private async ownOperation(path: string, op: () => Promise<Stats | null>): Promise<void> {
        const key = path.normalize("NFC");
        this.ownBusy.set(key, (this.ownBusy.get(key) ?? 0) + 1);
        try {
            const stat = await op();
            if (this.emitter.size > 0) this.ownWrites.set(key, signature(stat));
        } finally {
            const count = this.ownBusy.get(key)! - 1;
            if (count > 0) this.ownBusy.set(key, count);
            else this.ownBusy.delete(key);
        }
    }

    watch(listener: (changes: FileChange[]) => void): () => void {
        const unsubscribe = this.emitter.add(listener, () => this.stopWatching());
        if (!this.watcher) this.startWatching();
        return unsubscribe;
    }

    private startWatching() {
        // Recursive fs.watch works on macOS and Windows, and on Linux since Node 20.
        const root = this.realRoot ?? this.root;
        try {
            this.watcher = fsWatch(root, { recursive: true }, (_event, filename) => {
                if (filename) this.queue(String(filename).split(nodePath.sep).join("/"));
            });
            this.watcher.on("error", () => this.stopWatching());
        } catch {
            // Unwatchable (e.g. removable media gone): editing still works, without change events.
        }
    }

    private queue(path: string) {
        this.pendingPaths.add(path);
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => void this.flush(), WATCH_DEBOUNCE_MS);
    }

    private stopWatching() {
        this.watcher?.close();
        this.watcher = null;
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = null;
        this.pendingPaths.clear();
        this.ownWrites.clear();
    }

    private async flush() {
        const paths = [...this.pendingPaths];
        this.pendingPaths.clear();
        const changes: FileChange[] = [];
        const retry: string[] = [];
        for (const raw of paths) {
            let path: string;
            try {
                path = parsePath(raw).join("/");
            } catch {
                continue;
            }
            const base = path.slice(path.lastIndexOf("/") + 1);
            if (isJunkFile(base)) continue;
            // An own write of this path in progress, or one made while we look at the file: try
            // again once it's done, when its signature is in ownWrites.
            const ownBefore = this.ownWrites.get(path);
            if (this.ownBusy.has(path)) {
                retry.push(raw);
                continue;
            }
            const isFile = await this.exists(path).catch(() => false);
            let stat: Stats | null = null;
            if (isFile) stat = await fsp.stat(nodePath.join(await this.rootReal(), path)).catch(() => null);
            else if (await this.isDirectory(path)) continue; // directory events carry no file change
            if (this.ownBusy.has(path) || this.ownWrites.get(path) !== ownBefore) {
                retry.push(raw);
                continue;
            }
            const sig = signature(stat);
            if (this.ownWrites.get(path) === sig) continue;
            this.ownWrites.delete(path);
            changes.push({ path, kind: stat ? "changed" : "deleted" });
        }
        if (!this.watcher) return;
        for (const raw of retry) this.queue(raw);
        if (changes.length > 0) this.emitter.emit(changes);
    }

    private async isDirectory(path: string): Promise<boolean> {
        return (await this.lookup(parsePath(path)))?.kind === "directory";
    }

    /** Stops watching. */
    close() {
        this.stopWatching();
    }
}

function signature(stat: Stats | null): string {
    return stat ? `${stat.mtimeMs}:${stat.size}` : "deleted";
}
