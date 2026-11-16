import { randomUUID } from "node:crypto";
import { promises as fsp } from "node:fs";
import * as nodePath from "node:path";
import { ProjectFsError } from "../errors.js";
import { NodeFileSystem } from "../node.js";
import type { FileTypeFilter } from "../types.js";
import { CHANGE_EVENT, CHANNEL_PREFIX, type PickFileOptions, type PickFolderOptions, type Reply, type RootInfo } from "./protocol.js";

// The main-process half of the Electron adapter. Structural types stand in for Electron's own,
// so this folder doesn't depend on the electron package: pass in `ipcMain` and `dialog`.

export interface SenderLike {
    readonly id: number;
    send(channel: string, ...args: unknown[]): void;
    once?(event: "destroyed", listener: () => void): unknown;
    isDestroyed?(): boolean;
}

export interface IpcMainLike {
    handle(channel: string, listener: (event: { sender: SenderLike }, ...args: unknown[]) => unknown): void;
    removeHandler(channel: string): void;
}

export interface DialogLike {
    showOpenDialog(options: {
        title?: string;
        message?: string;
        buttonLabel?: string;
        properties: string[];
        filters?: { name: string; extensions: string[] }[];
    }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

export interface ProjectFsMainOptions {
    ipcMain: IpcMainLike;
    /** Electron's dialog module, or a stand-in. Without it the pick* channels report NOT_SUPPORTED. */
    dialog?: DialogLike;
}

export interface ProjectFsMain {
    /**
     * Approves an absolute directory for a window without a dialog, for paths the main process
     * itself trusts (a recent-projects list it keeps, a command-line argument, a dropped file
     * whose path it resolved). Never call this with a path the renderer sent.
     */
    approveRoot(sender: SenderLike, absPath: string): Promise<RootInfo>;
    /** Removes every handler and stops every watcher. */
    dispose(): void;
}

interface Root {
    fs: NodeFileSystem;
    sender: SenderLike;
    unwatch?: () => void;
}

export function toElectronFilters(filters: FileTypeFilter[] = []) {
    return filters.map((f) => ({ name: f.description, extensions: f.extensions.map((e) => e.replace(/^\./, "")) }));
}

/**
 * Registers the projectFs:* IPC handlers. Roots are kept per window (by sender id), so a root id
 * from one window is useless in another. Every argument from the renderer is treated as
 * untrusted: types are checked, ids must match, and paths go through NodeFileSystem's checks.
 */
export function registerProjectFsHandlers(options: ProjectFsMainOptions): ProjectFsMain {
    const { ipcMain, dialog } = options;
    const roots = new Map<string, Root>();
    const channels: string[] = [];
    const trackedSenders = new Set<number>();

    async function approve(sender: SenderLike, absPath: string): Promise<RootInfo> {
        if (typeof absPath !== "string" || !nodePath.isAbsolute(absPath)) {
            throw new ProjectFsError("INVALID_PATH", "Root must be an absolute path");
        }
        const real = await fsp.realpath(absPath);
        if (!(await fsp.stat(real)).isDirectory()) throw new ProjectFsError("NOT_A_DIRECTORY", `Not a folder: ${absPath}`);
        const rootId = randomUUID();
        roots.set(rootId, { fs: new NodeFileSystem(real), sender });
        if (!trackedSenders.has(sender.id) && sender.once) {
            trackedSenders.add(sender.id);
            sender.once("destroyed", () => {
                trackedSenders.delete(sender.id);
                for (const [id, root] of roots) if (root.sender.id === sender.id) drop(id);
            });
        }
        return { rootId, name: nodePath.basename(real), displayPath: real };
    }

    function drop(rootId: string) {
        const root = roots.get(rootId);
        if (!root) return;
        root.unwatch?.();
        root.fs.close();
        roots.delete(rootId);
    }

    function rootFor(sender: SenderLike, rootId: unknown): Root {
        const root = typeof rootId === "string" ? roots.get(rootId) : undefined;
        if (!root || root.sender.id !== sender.id) throw new ProjectFsError("UNKNOWN_ROOT", "Unknown project root");
        return root;
    }

    function str(value: unknown, what: string): string {
        if (typeof value !== "string") throw new ProjectFsError("INVALID_PATH", `${what} must be a string`);
        return value;
    }

    function handle(name: string, fn: (sender: SenderLike, ...args: unknown[]) => Promise<unknown>) {
        const channel = CHANNEL_PREFIX + name;
        channels.push(channel);
        ipcMain.handle(channel, async (event, ...args): Promise<Reply<unknown>> => {
            try {
                return { ok: true, value: await fn(event.sender, ...args) };
            } catch (err) {
                if (err instanceof ProjectFsError) return { ok: false, code: err.code, message: err.message };
                // Don't leak absolute paths from Node's own error messages to the renderer.
                const code = (err as NodeJS.ErrnoException)?.code;
                return { ok: false, code: code === "ENOENT" ? "NOT_FOUND" : "IO", message: code ?? "I/O error" };
            }
        });
    }

    function dialogOrThrow(): DialogLike {
        if (!dialog) throw new ProjectFsError("NOT_SUPPORTED", "No dialog available");
        return dialog;
    }

    function pickOptions(raw: unknown): PickFileOptions {
        const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
        const text = (v: unknown) => (typeof v === "string" ? v : undefined);
        const filters = Array.isArray(o.filters)
            ? (o.filters as unknown[]).filter((f): f is FileTypeFilter =>
                !!f && typeof (f as FileTypeFilter).description === "string" &&
                Array.isArray((f as FileTypeFilter).extensions) &&
                (f as FileTypeFilter).extensions.every((e) => typeof e === "string"))
            : undefined;
        return { title: text(o.title), message: text(o.message), buttonLabel: text(o.buttonLabel), filters };
    }

    async function pickDirectory(sender: SenderLike, raw: unknown, create: boolean) {
        const o: PickFolderOptions = pickOptions(raw);
        const properties = create ? ["openDirectory", "createDirectory", "promptToCreate"] : ["openDirectory"];
        const result = await dialogOrThrow().showOpenDialog({ ...o, properties });
        if (result.canceled || result.filePaths.length === 0) return null;
        return approve(sender, result.filePaths[0]);
    }

    handle("pickFolder", (sender, o) => pickDirectory(sender, o, false));
    handle("pickNewFolder", (sender, o) => pickDirectory(sender, o, true));
    handle("pickFile", async (sender, raw) => {
        const o = pickOptions(raw);
        const result = await dialogOrThrow().showOpenDialog({
            title: o.title,
            message: o.message,
            buttonLabel: o.buttonLabel,
            properties: ["openFile"],
            filters: o.filters ? toElectronFilters(o.filters) : undefined,
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        const real = await fsp.realpath(result.filePaths[0]);
        const info = await approve(sender, nodePath.dirname(real));
        return { ...info, mainFile: nodePath.basename(real).normalize("NFC") };
    });
    handle("release", async (sender, rootId) => {
        rootFor(sender, rootId);
        drop(rootId as string);
    });

    handle("list", (sender, rootId, dir) => rootFor(sender, rootId).fs.list(dir === undefined ? "" : str(dir, "dir")));
    handle("read", (sender, rootId, path) => rootFor(sender, rootId).fs.read(str(path, "path")));
    handle("exists", (sender, rootId, path) => rootFor(sender, rootId).fs.exists(str(path, "path")));
    handle("delete", (sender, rootId, path) => rootFor(sender, rootId).fs.delete(str(path, "path")));
    handle("write", (sender, rootId, path, data) => {
        const root = rootFor(sender, rootId);
        if (typeof data !== "string" && !(data instanceof Uint8Array)) {
            throw new ProjectFsError("IO", "Data must be a string or a Uint8Array");
        }
        return root.fs.write(str(path, "path"), data);
    });
    handle("watch", async (sender, rootId) => {
        const root = rootFor(sender, rootId);
        if (root.unwatch) return;
        root.unwatch = root.fs.watch((changes) => {
            if (!sender.isDestroyed?.()) sender.send(CHANGE_EVENT, rootId, changes);
        });
    });
    handle("unwatch", async (sender, rootId) => {
        const root = rootFor(sender, rootId);
        root.unwatch?.();
        root.unwatch = undefined;
    });

    return {
        approveRoot: approve,
        dispose() {
            for (const c of channels) ipcMain.removeHandler(c);
            for (const id of [...roots.keys()]) drop(id);
        },
    };
}
