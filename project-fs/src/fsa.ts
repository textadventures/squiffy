import { DirectoryHandleFileSystem } from "./handle.js";
import type { FileTypeFilter } from "./types.js";

// File System Access pickers. Not in TypeScript's DOM lib, since only Chromium ships them.
type WellKnownDirectory = "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos";
interface DirectoryPickerOptions {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: FileSystemHandle | WellKnownDirectory;
}
interface PermissionDescriptor {
    mode?: "read" | "readwrite";
}
interface HandleWithPermissions {
    queryPermission?(d: PermissionDescriptor): Promise<PermissionState>;
    requestPermission?(d: PermissionDescriptor): Promise<PermissionState>;
}
declare global {
    interface Window {
        showDirectoryPicker?(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
    }
}

/** Whether this browser can open real folders (Chromium-based browsers, not Electron). */
export function hasFileSystemAccess(): boolean {
    return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

function isAbort(err: unknown) {
    return err instanceof Error && err.name === "AbortError";
}

export interface FsaPickOptions {
    /** Lets the browser remember the last folder per purpose. */
    id?: string;
    startIn?: FileSystemHandle | WellKnownDirectory;
}

/**
 * Opens projects through the File System Access API. The browser only grants folders, not a
 * file plus its folder, so there's no openFile(): open the folder, then pick the main file
 * from it (see findFiles()).
 */
export const fsaOpener = {
    /** Returns null if the user cancels. */
    async openFolder(options: FsaPickOptions = {}): Promise<DirectoryHandleFileSystem | null> {
        try {
            const handle = await window.showDirectoryPicker!({ ...options, mode: "readwrite" });
            return new DirectoryHandleFileSystem(handle);
        } catch (err) {
            if (isAbort(err)) return null;
            throw err;
        }
    },

    /**
     * Save As: pick a folder to become the new root. The picker can create a folder. Copy the
     * project across with copyProject().
     */
    pickNewRoot(options: FsaPickOptions = {}): Promise<DirectoryHandleFileSystem | null> {
        return fsaOpener.openFolder(options);
    },

    /**
     * Reopens a handle kept from an earlier session (handles can be stored in IndexedDB).
     * Must be called from a user gesture if the browser needs to ask again. Returns null if
     * the user says no.
     */
    async reopen(handle: FileSystemDirectoryHandle): Promise<DirectoryHandleFileSystem | null> {
        return (await ensurePermission(handle)) ? new DirectoryHandleFileSystem(handle) : null;
    },
};

export async function ensurePermission(handle: FileSystemHandle, mode: "read" | "readwrite" = "readwrite"): Promise<boolean> {
    const h = handle as FileSystemHandle & HandleWithPermissions;
    if (!h.queryPermission || !h.requestPermission) return true;
    if ((await h.queryPermission({ mode })) === "granted") return true;
    return (await h.requestPermission({ mode })) === "granted";
}

/** The `types` option for showOpenFilePicker/showSaveFilePicker, from caller-supplied filters. */
export function toFsaAcceptTypes(filters: FileTypeFilter[]) {
    return filters.map((f) => ({
        description: f.description,
        accept: { [f.mimeType ?? "application/octet-stream"]: f.extensions as `.${string}`[] },
    }));
}

