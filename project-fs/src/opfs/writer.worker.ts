// Safari has no FileSystemFileHandle.createWritable() on the main thread, only the worker-only
// createSyncAccessHandle(), so OPFS writes go through this worker there. See writer.ts.
import { handleWriteRequest, type WriteRequest } from "./writer-core.js";

self.onmessage = async (e: MessageEvent<WriteRequest>) => {
    const root = await navigator.storage.getDirectory();
    self.postMessage(await handleWriteRequest(root, e.data));
};
