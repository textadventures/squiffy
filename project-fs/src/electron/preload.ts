import type { FileChange } from "../types.js";
import { CHANGE_EVENT, CHANNEL_PREFIX, unwrap, type ProjectFsBridge, type Reply } from "./protocol.js";

// The preload half: forwards the bridge API to the main process. Structural types stand in for
// Electron's ipcRenderer and contextBridge.

export interface IpcRendererLike {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
    removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
}

export interface ContextBridgeLike {
    exposeInMainWorld(key: string, api: unknown): void;
}

export function createProjectFsBridge(ipcRenderer: IpcRendererLike): ProjectFsBridge {
    const call = async <T>(name: string, ...args: unknown[]): Promise<T> =>
        unwrap((await ipcRenderer.invoke(CHANNEL_PREFIX + name, ...args)) as Reply<T>);
    return {
        pickFolder: (o) => call("pickFolder", o),
        pickFile: (o) => call("pickFile", o),
        pickNewFolder: (o) => call("pickNewFolder", o),
        release: (id) => call("release", id),
        list: (id, dir) => call("list", id, dir),
        read: (id, path) => call("read", id, path),
        write: (id, path, data) => call("write", id, path, data),
        delete: (id, path) => call("delete", id, path),
        exists: (id, path) => call("exists", id, path),
        watch: (id) => call("watch", id),
        unwatch: (id) => call("unwatch", id),
        onChange(listener) {
            const wrapped = (_event: unknown, ...args: unknown[]) => listener(args[0] as string, args[1] as FileChange[]);
            ipcRenderer.on(CHANGE_EVENT, wrapped);
            return () => void ipcRenderer.removeListener(CHANGE_EVENT, wrapped);
        },
    };
}

/** In a preload script: `exposeProjectFs(contextBridge, ipcRenderer)`. */
export function exposeProjectFs(contextBridge: ContextBridgeLike, ipcRenderer: IpcRendererLike, key = "projectFs"): void {
    contextBridge.exposeInMainWorld(key, createProjectFsBridge(ipcRenderer));
}
