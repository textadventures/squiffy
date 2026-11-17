import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { exposeProjectFs } from "@textadventures/project-fs/electron-preload";
import { CHANNEL_PREFIX, type MenuAction, type SquiffyDesktopApi } from "./api.js";

// Runs sandboxed, so this is bundled into one CommonJS file (scripts/build.mjs).

function on<T extends unknown[]>(channel: string, listener: (...args: T) => void): () => void {
    const wrapped = (_event: IpcRendererEvent, ...args: unknown[]) => listener(...(args as T));
    ipcRenderer.on(CHANNEL_PREFIX + channel, wrapped);
    return () => void ipcRenderer.removeListener(CHANNEL_PREFIX + channel, wrapped);
}

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(CHANNEL_PREFIX + channel, ...args) as Promise<T>;

const api: SquiffyDesktopApi = {
    platform: process.platform === "darwin" ? "mac" : process.platform === "win32" ? "windows" : "linux",
    recent: {
        list: () => invoke("recent:list"),
        open: (id) => invoke("recent:open", id),
        remember: (rootId, mainFile) => invoke("recent:remember", rootId, mainFile),
        update: (id, mainFile) => invoke("recent:update", id, mainFile),
        forget: (id) => invoke("recent:forget", id),
        onChanged: (listener) => on("recent-changed", listener),
    },
    menu: {
        onAction: (listener) => on<[MenuAction]>("menu", listener),
        onOpenRecent: (listener) => on<[string]>("open-recent", listener),
    },
    onBeforeClose: (listener) =>
        on("before-close", () => {
            void listener().finally(() => ipcRenderer.send(CHANNEL_PREFIX + "close-ready"));
        }),
};

// Only the editor's own window gets the bridges. A window it opens (Play in a new tab runs the
// published story, which is the author's code) gets nothing; the main process checks the
// sender as well.
if (!window.opener) {
    exposeProjectFs(contextBridge, ipcRenderer);
    contextBridge.exposeInMainWorld("squiffyDesktop", api);
}
