import { blobUrl, ChangeEmitter } from "../base.js";
import { parsePath } from "../paths.js";
import type { FileChange, FileEntry, FileUrl, ProjectFileSystem } from "../types.js";
import { fromBridgeError, type PickFileOptions, type PickFolderOptions, type ProjectFsBridge, type RootInfo } from "./protocol.js";

// Rebuilds the ProjectFsError a bridge call failed with, which contextBridge flattens to an Error
function call<T>(promise: Promise<T>): Promise<T> {
    return promise.catch((err: unknown) => {
        throw fromBridgeError(err);
    });
}

/**
 * The renderer half: a ProjectFileSystem that forwards to the main process through the preload
 * bridge. Paths are validated here too, for early errors, but the main process doesn't rely on it.
 */
export class ElectronFileSystem implements ProjectFileSystem {
    readonly name: string;
    readonly rootId: string;
    /** Absolute folder path, for display only. */
    readonly displayPath: string;
    private readonly emitter = new ChangeEmitter();
    private unsubscribe: (() => void) | null = null;

    constructor(
        private readonly bridge: ProjectFsBridge,
        info: RootInfo,
    ) {
        this.rootId = info.rootId;
        this.name = info.name;
        this.displayPath = info.displayPath;
    }

    async list(dir = ""): Promise<FileEntry[]> {
        parsePath(dir, true);
        return call(this.bridge.list(this.rootId, dir));
    }

    async read(path: string): Promise<Uint8Array> {
        parsePath(path);
        return call(this.bridge.read(this.rootId, path));
    }

    async readText(path: string): Promise<string> {
        return new TextDecoder("utf-8").decode(await this.read(path));
    }

    async write(path: string, data: Uint8Array | string): Promise<void> {
        parsePath(path);
        return call(this.bridge.write(this.rootId, path, data));
    }

    async delete(path: string): Promise<void> {
        parsePath(path);
        return call(this.bridge.delete(this.rootId, path));
    }

    async exists(path: string): Promise<boolean> {
        parsePath(path);
        return call(this.bridge.exists(this.rootId, path));
    }

    async url(path: string): Promise<FileUrl> {
        return blobUrl(await this.read(path), path);
    }

    watch(listener: (changes: FileChange[]) => void): () => void {
        const unsubscribe = this.emitter.add(listener, () => {
            this.unsubscribe?.();
            this.unsubscribe = null;
            void this.bridge.unwatch(this.rootId);
        });
        if (!this.unsubscribe) {
            this.unsubscribe = this.bridge.onChange((rootId, changes) => {
                if (rootId === this.rootId) this.emitter.emit(changes);
            });
            void this.bridge.watch(this.rootId);
        }
        return unsubscribe;
    }

    /** Tells the main process to forget this root. The instance stops working. */
    release(): Promise<void> {
        this.unsubscribe?.();
        this.unsubscribe = null;
        return call(this.bridge.release(this.rootId));
    }
}

/** Opens projects through native dialogs in the Electron main process. */
export function electronOpener(bridge: ProjectFsBridge) {
    return {
        async openFolder(options?: PickFolderOptions): Promise<ElectronFileSystem | null> {
            const info = await call(bridge.pickFolder(options));
            return info && new ElectronFileSystem(bridge, info);
        },
        /** Unlike the browser, Electron can pick the main file directly; its folder is the root. */
        async openFile(options?: PickFileOptions): Promise<{ fs: ElectronFileSystem; mainFile: string } | null> {
            const info = await call(bridge.pickFile(options));
            return info && { fs: new ElectronFileSystem(bridge, info), mainFile: info.mainFile };
        },
        /** Save As: pick or create a folder to become the new root, then copyProject() into it. */
        async pickNewRoot(options?: PickFolderOptions): Promise<ElectronFileSystem | null> {
            const info = await call(bridge.pickNewFolder(options));
            return info && new ElectronFileSystem(bridge, info);
        },
    };
}
