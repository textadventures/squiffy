// The app's side of the language service worker.
import { connect, type Handlers, type Port } from "../rpc.js";
import type { HostApi, WorkerApi } from "./protocol.js";

export type LanguageClient = ReturnType<typeof createLanguageClient>;

export function createLanguageClient(files: HostApi) {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const endpoint = connect<WorkerApi & Handlers>(worker as Port, files as unknown as Handlers);
    return {
        call: endpoint.call,
        dispose: () => worker.terminate(),
    };
}
