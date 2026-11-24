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
    newStory: {
        location: () => invoke("new-story:location"),
        chooseLocation: () => invoke("new-story:choose-location"),
        create: (folderName) => invoke("new-story:create", folderName),
    },
    menu: {
        onAction: (listener) => on<[MenuAction]>("menu", listener),
        onOpenRecent: (listener) => on<[string]>("open-recent", listener),
    },
    showInFolder: (rootId, path) => invoke("show-in-folder", rootId, path),
    playStory: (html) => invoke("play-story", html),
    onBeforeClose: (listener) =>
        on("before-close", () => {
            void listener().finally(() => ipcRenderer.send(CHANNEL_PREFIX + "close-ready"));
        }),
};

// Only the editor's own window gets the bridges. The main process lets it open no windows (Play in
// a new tab's story window has no preload at all), but one that had an opener would get nothing;
// the main process checks the sender as well.
if (!window.opener) {
    exposeProjectFs(contextBridge, ipcRenderer);
    contextBridge.exposeInMainWorld("squiffyDesktop", api);
}
