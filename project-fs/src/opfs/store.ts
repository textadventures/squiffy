import { ProjectFsError } from "../errors.js";
import { DirectoryHandleFileSystem, dirHandle, writableStreamWriter, type HandleWriter } from "../handle.js";
import { checkSegment } from "../paths.js";
import { defaultCreateWorker, supportsMainThreadWrite, workerWriter } from "./writer.js";

export interface StoredProject<Meta> {
    id: string;
    /** Whatever the caller last stored with setMeta(), or null. */
    meta: Meta | null;
}

export interface OpfsProjectStoreOptions {
    /** Directory under the OPFS root that holds the projects. Default "projects". */
    baseDir?: string;
    /** The OPFS root. Default navigator.storage.getDirectory(); tests pass a fake. */
    getRoot?: () => Promise<FileSystemDirectoryHandle>;
    /** Creates the Safari write worker. See defaultCreateWorker. */
    createWorker?: () => Worker;
    /** Force the write path (tests). Default: createWritable() if available, else the worker. */
    useWorker?: boolean;
}

const FILES = "files";
const META = "meta.json";

/**
 * Projects kept in the origin-private file system, for working without picking a folder (and
 * in browsers without File System Access). Layout, under the OPFS root:
 *
 *     projects/<id>/meta.json   the caller's own JSON (e.g. title, last opened); opaque here
 *     projects/<id>/files/...   the project tree, which open() returns as a ProjectFileSystem
 *
 * Ids are chosen by the caller (a UUID, or a slug) and must be a valid single path segment.
 * OPFS is case-sensitive; the ProjectFileSystem still refuses case-only conflicts, so a project
 * can be exported to a real folder unchanged.
 */
export class OpfsProjectStore<Meta = unknown> {
    private readonly baseDir: string;
    private readonly getRoot: () => Promise<FileSystemDirectoryHandle>;
    private readonly writer: HandleWriter;

    constructor(options: OpfsProjectStoreOptions = {}) {
        this.baseDir = options.baseDir ?? "projects";
        checkSegment(this.baseDir);
        this.getRoot = options.getRoot ?? (() => navigator.storage.getDirectory());
        const useWorker = options.useWorker ?? !supportsMainThreadWrite();
        if (useWorker) {
            let worker: Worker | undefined;
            const create = options.createWorker ?? defaultCreateWorker;
            // Worker paths are from the OPFS root, but every write below is relative to the
            // store's base directory, so prefix it.
            this.writer = workerWriter([this.baseDir], () => (worker ??= create()));
        } else {
            this.writer = writableStreamWriter;
        }
    }

    private async base(): Promise<FileSystemDirectoryHandle> {
        return dirHandle(await this.getRoot(), [this.baseDir], true);
    }

    private async projectDir(id: string): Promise<FileSystemDirectoryHandle | null> {
        checkSegment(id);
        try {
            return await (await this.base()).getDirectoryHandle(id);
        } catch {
            return null;
        }
    }

    async listProjects(): Promise<StoredProject<Meta>[]> {
        const out: StoredProject<Meta>[] = [];
        for await (const [id, handle] of (await this.base()).entries()) {
            if (handle.kind === "directory") out.push({ id, meta: await this.getMeta(id) });
        }
        return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }

    async exists(id: string): Promise<boolean> {
        return (await this.projectDir(id)) !== null;
    }

    /** Creates an empty project. Throws if the id is taken. */
    async create(id: string, meta?: Meta): Promise<DirectoryHandleFileSystem> {
        if (await this.exists(id)) throw new ProjectFsError("IO", `Project ${id} already exists`);
        const dir = await (await this.base()).getDirectoryHandle(id, { create: true });
        await dir.getDirectoryHandle(FILES, { create: true });
        if (meta !== undefined) await this.setMeta(id, meta);
        void requestPersistentStorage();
        return this.wrap(id, dir);
    }

    async open(id: string): Promise<DirectoryHandleFileSystem> {
        const dir = await this.projectDir(id);
        if (!dir) throw new ProjectFsError("NOT_FOUND", `No project ${id}`);
        return this.wrap(id, dir);
    }

    private async wrap(id: string, dir: FileSystemDirectoryHandle) {
        const files = await dir.getDirectoryHandle(FILES, { create: true });
        const base = await this.base();
        const writer = this.writer;
        // The store's writer takes paths from the base directory (that's what the worker needs).
        return new DirectoryHandleFileSystem(files, (_root, path, data) => writer(base, [id, FILES, ...path], data), id);
    }

    async getMeta(id: string): Promise<Meta | null> {
        const dir = await this.projectDir(id);
        if (!dir) return null;
        try {
            const text = await (await (await dir.getFileHandle(META)).getFile()).text();
            return JSON.parse(text) as Meta;
        } catch {
            return null;
        }
    }

    async setMeta(id: string, meta: Meta): Promise<void> {
        if (!(await this.exists(id))) throw new ProjectFsError("NOT_FOUND", `No project ${id}`);
        await this.writer(await this.base(), [id, META], new TextEncoder().encode(JSON.stringify(meta)));
    }

    /**
     * Moves a project to a new id, with its files and meta. OPFS has no portable directory move,
     * so this copies, then deletes the old one.
     */
    async rename(id: string, newId: string): Promise<void> {
        if (id === newId) return;
        const from = await this.projectDir(id);
        if (!from) throw new ProjectFsError("NOT_FOUND", `No project ${id}`);
        if (await this.exists(newId)) throw new ProjectFsError("IO", `Project ${newId} already exists`);
        const base = await this.base();
        await base.getDirectoryHandle(newId, { create: true });
        await this.copyTree(from, [newId]);
        await base.removeEntry(id, { recursive: true });
    }

    private async copyTree(from: FileSystemDirectoryHandle, to: string[]): Promise<void> {
        const base = await this.base();
        await dirHandle(base, to, true);
        for await (const [name, handle] of from.entries()) {
            if (handle.kind === "directory") {
                await this.copyTree(handle as FileSystemDirectoryHandle, [...to, name]);
            } else {
                const file = await (handle as FileSystemFileHandle).getFile();
                await this.writer(base, [...to, name], new Uint8Array(await file.arrayBuffer()));
            }
        }
    }

    async delete(id: string): Promise<void> {
        if (!(await this.exists(id))) return;
        await (await this.base()).removeEntry(id, { recursive: true });
    }
}

let persistRequested = false;
async function requestPersistentStorage(): Promise<void> {
    if (persistRequested) return;
    persistRequested = true;
    try {
        // Best-effort: lowers the eviction risk under storage pressure. Doesn't help against
        // Safari's 7-day eviction of script-written storage for sites the user hasn't visited.
        await globalThis.navigator?.storage?.persist?.();
    } catch {
        // ignore
    }
}
