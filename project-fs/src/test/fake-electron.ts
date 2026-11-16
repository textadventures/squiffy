import type { DialogLike, IpcMainLike, SenderLike } from "../electron/main.js";
import type { IpcRendererLike } from "../electron/preload.js";

type Handler = Parameters<IpcMainLike["handle"]>[1];
type Listener = (event: unknown, ...args: unknown[]) => void;

/** Stands in for Electron's ipcMain. Arguments and replies are structured-cloned, like real IPC. */
export class FakeIpcMain implements IpcMainLike {
    readonly handlers = new Map<string, Handler>();

    handle(channel: string, listener: Handler): void {
        if (this.handlers.has(channel)) throw new Error(`Second handler for ${channel}`);
        this.handlers.set(channel, listener);
    }

    removeHandler(channel: string): void {
        this.handlers.delete(channel);
    }

    async invoke(sender: SenderLike, channel: string, ...args: unknown[]): Promise<unknown> {
        const h = this.handlers.get(channel);
        if (!h) throw new Error(`No handler registered for '${channel}'`);
        return structuredClone(await h({ sender }, ...structuredClone(args)));
    }
}

/** A window: the main process's webContents (sender) and its renderer's ipcRenderer. */
export class FakeWindow implements SenderLike {
    private static nextId = 1;
    readonly id = FakeWindow.nextId++;
    private destroyed = false;
    private readonly destroyListeners: (() => void)[] = [];
    private readonly listeners = new Map<string, Set<Listener>>();

    constructor(private readonly ipcMain: FakeIpcMain) {}

    // SenderLike
    send(channel: string, ...args: unknown[]): void {
        const cloned = structuredClone(args);
        for (const l of this.listeners.get(channel) ?? []) l({}, ...cloned);
    }
    once(_event: "destroyed", listener: () => void) {
        this.destroyListeners.push(listener);
    }
    isDestroyed() {
        return this.destroyed;
    }
    destroy() {
        this.destroyed = true;
        for (const l of this.destroyListeners) l();
    }

    readonly ipcRenderer: IpcRendererLike = {
        invoke: (channel, ...args) => this.ipcMain.invoke(this, channel, ...args),
        on: (channel, listener) => {
            if (!this.listeners.has(channel)) this.listeners.set(channel, new Set());
            this.listeners.get(channel)!.add(listener);
        },
        removeListener: (channel, listener) => {
            this.listeners.get(channel)?.delete(listener);
        },
    };
}

/** A dialog that "picks" whatever the test queued, or cancels if nothing is queued. */
export class FakeDialog implements DialogLike {
    readonly queue: string[] = [];
    readonly calls: Parameters<DialogLike["showOpenDialog"]>[0][] = [];

    async showOpenDialog(options: Parameters<DialogLike["showOpenDialog"]>[0]) {
        this.calls.push(options);
        const next = this.queue.shift();
        return next === undefined ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [next] };
    }
}
