import { ChangeEmitter, TreeFileSystem, type DirEntry, type FileStat } from "./base.js";
import { ProjectFsError } from "./errors.js";
import type { FileChange } from "./types.js";

interface FileNode {
    kind: "file";
    data: Uint8Array;
    lastModified: number;
}
interface DirNode {
    kind: "directory";
    children: Map<string, Node>;
}
type Node = FileNode | DirNode;

/**
 * Shared backing store for MemoryFileSystem. Several MemoryFileSystem instances over one store
 * see each other's writes as external changes, which is how tests exercise watch().
 */
export class MemoryStore {
    readonly root: DirNode = { kind: "directory", children: new Map() };
    private readonly views = new Set<MemoryFileSystem>();

    /** @internal */
    attach(view: MemoryFileSystem) {
        this.views.add(view);
    }

    /** @internal */
    notify(from: MemoryFileSystem, change: FileChange) {
        for (const v of this.views) if (v !== from) v.notifyExternal(change);
    }
}

/** An in-memory project, for tests and for projects that haven't been saved anywhere yet. */
export class MemoryFileSystem extends TreeFileSystem {
    readonly store: MemoryStore;
    private readonly emitter = new ChangeEmitter();

    constructor(
        readonly name = "Untitled",
        store?: MemoryStore,
    ) {
        super();
        this.store = store ?? new MemoryStore();
        this.store.attach(this);
    }

    /** Builds a project from a { path: content } map. */
    static async from(files: Record<string, Uint8Array | string>, name?: string): Promise<MemoryFileSystem> {
        const fs = new MemoryFileSystem(name);
        for (const [path, data] of Object.entries(files)) await fs.write(path, data);
        return fs;
    }

    private node(path: string[]): Node | undefined {
        let node: Node = this.store.root;
        for (const s of path) {
            if (node.kind !== "directory") return undefined;
            const child: Node | undefined = node.children.get(s);
            if (!child) return undefined;
            node = child;
        }
        return node;
    }

    private dir(path: string[]): DirNode {
        const n = this.node(path);
        if (n?.kind !== "directory") throw new ProjectFsError("IO", `No directory ${path.join("/")}`);
        return n;
    }

    protected async readDir(dir: string[]): Promise<DirEntry[] | null> {
        const n = this.node(dir);
        if (n?.kind !== "directory") return null;
        return [...n.children].map(([name, child]) => ({ name, kind: child.kind }));
    }

    protected async statFile(path: string[]): Promise<FileStat> {
        const n = this.node(path) as FileNode;
        return { size: n.data.byteLength, lastModified: n.lastModified };
    }

    protected async readFile(path: string[]): Promise<Uint8Array> {
        return (this.node(path) as FileNode).data.slice();
    }

    protected async writeFile(path: string[], data: Uint8Array): Promise<void> {
        this.dir(path.slice(0, -1)).children.set(path[path.length - 1], {
            kind: "file",
            data: data.slice(),
            lastModified: Date.now(),
        });
        this.store.notify(this, { path: path.join("/"), kind: "changed" });
    }

    protected async createDir(path: string[]): Promise<void> {
        this.dir(path.slice(0, -1)).children.set(path[path.length - 1], { kind: "directory", children: new Map() });
    }

    protected async removeFile(path: string[]): Promise<void> {
        this.dir(path.slice(0, -1)).children.delete(path[path.length - 1]);
        this.store.notify(this, { path: path.join("/"), kind: "deleted" });
    }

    protected async removeDir(path: string[]): Promise<void> {
        this.dir(path.slice(0, -1)).children.delete(path[path.length - 1]);
    }

    watch(listener: (changes: FileChange[]) => void): () => void {
        return this.emitter.add(listener);
    }

    /** @internal */
    notifyExternal(change: FileChange) {
        queueMicrotask(() => this.emitter.emit([change]));
    }
}
