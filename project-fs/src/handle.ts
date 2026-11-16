import { TreeFileSystem, type DirEntry, type FileStat } from "./base.js";
import { notFound } from "./errors.js";

/** Writes bytes to a file under a directory handle. Swappable so OPFS can fall back to a worker. */
export type HandleWriter = (root: FileSystemDirectoryHandle, path: string[], data: Uint8Array) => Promise<void>;

/** Writes through FileSystemFileHandle.createWritable(): File System Access, and OPFS outside Safari. */
export const writableStreamWriter: HandleWriter = async (root, path, data) => {
    const dir = await dirHandle(root, path.slice(0, -1));
    const fh = await dir.getFileHandle(path[path.length - 1], { create: true });
    const writable = await fh.createWritable();
    try {
        await writable.write(data.slice());
    } finally {
        await writable.close();
    }
};

export async function dirHandle(root: FileSystemDirectoryHandle, path: string[], create = false) {
    let dir = root;
    for (const s of path) dir = await dir.getDirectoryHandle(s, { create });
    return dir;
}

function isMissing(err: unknown) {
    return err instanceof Error && (err.name === "NotFoundError" || err.name === "TypeMismatchError");
}

/**
 * A project rooted at a FileSystemDirectoryHandle. The same code serves a folder the user picked
 * with the File System Access API and a directory inside the origin-private file system (OPFS),
 * since both hand out the same handle types. Only the write path differs (see HandleWriter).
 */
export class DirectoryHandleFileSystem extends TreeFileSystem {
    constructor(
        readonly root: FileSystemDirectoryHandle,
        private readonly writer: HandleWriter = writableStreamWriter,
        readonly name: string = root.name,
    ) {
        super();
    }

    protected async readDir(path: string[]): Promise<DirEntry[] | null> {
        let dir: FileSystemDirectoryHandle;
        try {
            dir = await dirHandle(this.root, path);
        } catch (err) {
            if (isMissing(err)) return null;
            throw err;
        }
        const out: DirEntry[] = [];
        for await (const [name, handle] of dir.entries()) out.push({ name, kind: handle.kind });
        return out;
    }

    private async file(path: string[]): Promise<File> {
        try {
            const dir = await dirHandle(this.root, path.slice(0, -1));
            return await (await dir.getFileHandle(path[path.length - 1])).getFile();
        } catch (err) {
            if (isMissing(err)) throw notFound(path.join("/"));
            throw err;
        }
    }

    protected async statFile(path: string[]): Promise<FileStat> {
        const f = await this.file(path);
        return { size: f.size, lastModified: f.lastModified };
    }

    protected async readFile(path: string[]): Promise<Uint8Array> {
        return new Uint8Array(await (await this.file(path)).arrayBuffer());
    }

    protected writeFile(path: string[], data: Uint8Array): Promise<void> {
        return this.writer(this.root, path, data);
    }

    protected async createDir(path: string[]): Promise<void> {
        await dirHandle(this.root, path, true);
    }

    protected async removeFile(path: string[]): Promise<void> {
        const dir = await dirHandle(this.root, path.slice(0, -1));
        await dir.removeEntry(path[path.length - 1]);
    }

    protected async removeDir(path: string[]): Promise<void> {
        const dir = await dirHandle(this.root, path.slice(0, -1));
        await dir.removeEntry(path[path.length - 1]);
    }
}
