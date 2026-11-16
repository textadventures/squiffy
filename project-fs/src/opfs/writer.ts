import type { HandleWriter } from "../handle.js";
import type { WriteRequest, WriteResponse } from "./writer-core.js";

// OPFS reads, listing and removeEntry work on the main thread everywhere OPFS exists. Only
// createWritable() is missing in Safari, so writes alone go through a worker there.

export function supportsMainThreadWrite(): boolean {
    return typeof FileSystemFileHandle !== "undefined" && "createWritable" in FileSystemFileHandle.prototype;
}

/**
 * Creates the write worker. The default works inside an app bundled by Vite. If this folder
 * becomes a published package, inline the worker (a Blob URL) instead, since Vite's dependency
 * pre-bundling can break `new URL(..., import.meta.url)` worker references in node_modules.
 */
export const defaultCreateWorker = () =>
    new Worker(new URL("./writer.worker.js", import.meta.url), { type: "module" });

/**
 * A HandleWriter that sends writes to a worker. Paths are sent from the OPFS root, so `root`
 * must be OPFS: `rootPath` gives its location under navigator.storage.getDirectory().
 */
export function workerWriter(rootPath: string[], getWorker: () => Worker): HandleWriter {
    return (_root, path, data) => postWrite(getWorker(), [...rootPath, ...path], data);
}

const pending = new WeakMap<Worker, Map<number, { resolve: () => void; reject: (e: Error) => void }>>();
let nextId = 1;

function postWrite(worker: Worker, path: string[], data: Uint8Array): Promise<void> {
    let calls = pending.get(worker);
    if (!calls) {
        const map = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
        worker.addEventListener("message", (e: MessageEvent<WriteResponse>) => {
            const call = map.get(e.data.id);
            if (!call) return;
            map.delete(e.data.id);
            if (e.data.ok) call.resolve();
            else call.reject(new Error(e.data.error));
        });
        pending.set(worker, map);
        calls = map;
    }
    const map = calls;
    return new Promise((resolve, reject) => {
        const id = nextId++;
        map.set(id, { resolve, reject });
        // Copy, so transferring the buffer doesn't detach memory the caller still holds.
        const copy = data.slice();
        const req: WriteRequest = { id, path, data: copy.buffer };
        worker.postMessage(req, [copy.buffer]);
    });
}
