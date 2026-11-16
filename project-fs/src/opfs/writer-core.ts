// The part of the Safari write fallback that runs inside the worker, kept apart from the worker's
// message plumbing so tests can run it against a fake OPFS root.

export interface WriteRequest {
    id: number;
    /** Segments from the OPFS root to the file, including the file name. */
    path: string[];
    data: ArrayBuffer;
}

export interface WriteResponse {
    id: number;
    ok: boolean;
    error?: string;
}

// createSyncAccessHandle() is worker-only, and Safari's only OPFS write API.
interface SyncAccessHandle {
    truncate(size: number): void;
    write(buffer: Uint8Array, options?: { at?: number }): number;
    flush(): void;
    close(): void;
}
interface FileHandleWithSyncAccess extends FileSystemFileHandle {
    createSyncAccessHandle(): Promise<SyncAccessHandle>;
}

export async function handleWriteRequest(root: FileSystemDirectoryHandle, req: WriteRequest): Promise<WriteResponse> {
    try {
        let dir = root;
        for (const segment of req.path.slice(0, -1)) dir = await dir.getDirectoryHandle(segment, { create: true });
        const fh = await dir.getFileHandle(req.path[req.path.length - 1], { create: true });
        const handle = await (fh as FileHandleWithSyncAccess).createSyncAccessHandle();
        try {
            handle.truncate(0);
            handle.write(new Uint8Array(req.data), { at: 0 });
            handle.flush();
        } finally {
            handle.close();
        }
        return { id: req.id, ok: true };
    } catch (err) {
        return { id: req.id, ok: false, error: String(err) };
    }
}
