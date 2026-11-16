// A small in-memory implementation of the File System Access handle types, enough to run the
// DirectoryHandleFileSystem and OPFS store in Node. `caseInsensitive` makes lookups behave like a
// macOS or Windows disk (names are stored as first written, matched ignoring case), which is
// what the File System Access API exposes there. `noWritable` drops createWritable(), as in Safari.

export interface FakeOptions {
    caseInsensitive?: boolean;
    noWritable?: boolean;
}

function domError(name: string, message: string) {
    return new DOMException(message, name);
}

type Child = FakeDirectoryHandle | FakeFileHandle;

export class FakeFileHandle {
    readonly kind = "file" as const;
    data = new Uint8Array();
    lastModified = Date.now();

    constructor(
        public name: string,
        private readonly options: FakeOptions,
    ) {
        if (options.noWritable) (this as { createWritable?: unknown }).createWritable = undefined;
    }

    async getFile(): Promise<File> {
        return new File([this.data.slice()], this.name, { lastModified: this.lastModified });
    }

    async createWritable() {
        if (this.options.noWritable) throw new TypeError("createWritable is not a function");
        const chunks: Uint8Array[] = [];
        return {
            write: async (data: BufferSource | Blob | string) => {
                if (typeof data === "string") chunks.push(new TextEncoder().encode(data));
                else if (data instanceof Blob) chunks.push(new Uint8Array(await data.arrayBuffer()));
                else if (ArrayBuffer.isView(data)) chunks.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice());
                else chunks.push(new Uint8Array(data).slice());
            },
            close: async () => {
                const total = chunks.reduce((n, c) => n + c.byteLength, 0);
                const out = new Uint8Array(total);
                let at = 0;
                for (const c of chunks) {
                    out.set(c, at);
                    at += c.byteLength;
                }
                this.data = out;
                this.lastModified = Date.now();
            },
        };
    }

    // Worker-only in browsers; available here so the Safari path can be exercised.
    async createSyncAccessHandle() {
        let buf = this.data.slice();
        return {
            truncate: (size: number) => {
                const next = new Uint8Array(size);
                next.set(buf.subarray(0, size));
                buf = next;
            },
            write: (data: Uint8Array, opts?: { at?: number }) => {
                const at = opts?.at ?? 0;
                if (at + data.byteLength > buf.byteLength) {
                    const next = new Uint8Array(at + data.byteLength);
                    next.set(buf);
                    buf = next;
                }
                buf.set(data, at);
                return data.byteLength;
            },
            flush: () => {
                this.data = buf.slice();
                this.lastModified = Date.now();
            },
            close: () => {},
        };
    }
}

export class FakeDirectoryHandle {
    readonly kind = "directory" as const;
    readonly children = new Map<string, Child>();

    constructor(
        public name: string,
        private readonly options: FakeOptions = {},
    ) {}

    private find(name: string): [string, Child] | undefined {
        if (!this.options.caseInsensitive) {
            const c = this.children.get(name);
            return c ? [name, c] : undefined;
        }
        const key = name.normalize("NFC").toLowerCase();
        for (const entry of this.children) if (entry[0].normalize("NFC").toLowerCase() === key) return entry;
        return undefined;
    }

    private checkName(name: string) {
        if (name === "" || name === "." || name === ".." || name.includes("/")) throw new TypeError(`Invalid name: ${name}`);
    }

    async getDirectoryHandle(name: string, opts: { create?: boolean } = {}): Promise<FakeDirectoryHandle> {
        this.checkName(name);
        const found = this.find(name);
        if (found) {
            if (found[1].kind !== "directory") throw domError("TypeMismatchError", `${name} is a file`);
            return found[1];
        }
        if (!opts.create) throw domError("NotFoundError", `${name} not found`);
        const dir = new FakeDirectoryHandle(name, this.options);
        this.children.set(name, dir);
        return dir;
    }

    async getFileHandle(name: string, opts: { create?: boolean } = {}): Promise<FakeFileHandle> {
        this.checkName(name);
        const found = this.find(name);
        if (found) {
            if (found[1].kind !== "file") throw domError("TypeMismatchError", `${name} is a directory`);
            return found[1];
        }
        if (!opts.create) throw domError("NotFoundError", `${name} not found`);
        const file = new FakeFileHandle(name, this.options);
        this.children.set(name, file);
        return file;
    }

    async removeEntry(name: string, opts: { recursive?: boolean } = {}): Promise<void> {
        const found = this.find(name);
        if (!found) throw domError("NotFoundError", `${name} not found`);
        if (found[1].kind === "directory" && found[1].children.size > 0 && !opts.recursive) {
            throw domError("InvalidModificationError", `${name} is not empty`);
        }
        this.children.delete(found[0]);
    }

    async *entries(): AsyncIterableIterator<[string, Child]> {
        for (const entry of [...this.children]) yield entry;
    }

    async *keys(): AsyncIterableIterator<string> {
        for (const k of [...this.children.keys()]) yield k;
    }

    async *values(): AsyncIterableIterator<Child> {
        for (const v of [...this.children.values()]) yield v;
    }

    [Symbol.asyncIterator]() {
        return this.entries();
    }
}

export function fakeRoot(options: FakeOptions = {}, name = "root"): FileSystemDirectoryHandle {
    return new FakeDirectoryHandle(name, options) as unknown as FileSystemDirectoryHandle;
}
