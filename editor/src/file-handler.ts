import { get, set } from "idb-keyval";
import { downloadString } from "./util";

// Feature detection for File System Access API
const hasFileSystemAccess = (): boolean => {
    return "showOpenFilePicker" in window;
};

let fileHandle: FileSystemFileHandle | null = null;
let currentFileName: string | null = null;
let onOpen: (data: string) => void;

export const setOnOpen = (fn: (data: string) => void) => {
    onOpen = fn;
};

const openFileFallback = async (): Promise<void> => {
    return new Promise((resolve, reject) => {
        const input = document.getElementById("file-input-fallback") as HTMLInputElement;
        if (!input) {
            reject(new Error("File input element not found"));
            return;
        }

        // Reset input to allow selecting same file again
        input.value = "";

        // Set up one-time event listener
        const handleChange = async (e: Event) => {
            const target = e.target as HTMLInputElement;
            const file = target.files?.[0];

            if (file) {
                currentFileName = file.name;
                const reader = new FileReader();
                reader.onload = (e) => {
                    onOpen(e.target?.result as string);
                    resolve();
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsText(file);
            } else {
                // User cancelled
                reject(new Error("No file selected"));
            }

            // Clean up listener
            input.removeEventListener("change", handleChange);
        };

        input.addEventListener("change", handleChange);
        input.click();
    });
};

export const openFile = async () => {
    // TODO: Check for unsaved changes first

    if (hasFileSystemAccess()) {
        // Modern API - Chrome, Edge
        [fileHandle] = await window.showOpenFilePicker();
        await addToRecentFiles(fileHandle);
        await openFileHandle();
    } else {
        // Fallback for Safari, Firefox
        await openFileFallback();
    }
};

interface RecentFile {
    handle: FileSystemFileHandle;
    name: string;
}

const MAX_RECENT_FILES = 10;

export const getRecentFiles = async (): Promise<RecentFile[]> => {
    // Only available with File System Access API
    if (!hasFileSystemAccess()) {
        return [];
    }

    const recentFiles = await get("recentFiles") as RecentFile[] | undefined;
    return recentFiles || [];
};

export const addToRecentFiles = async (handle: FileSystemFileHandle): Promise<void> => {
    // Only works with File System Access API
    if (!hasFileSystemAccess()) {
        return;
    }

    const file = await handle.getFile();
    const fileName = file.name;

    let recentFiles = await getRecentFiles();

    // Remove duplicate if file already exists (compare by name)
    recentFiles = recentFiles.filter(rf => rf.name !== fileName);

    // Add to front of list
    recentFiles.unshift({ handle, name: fileName });

    // Limit to MAX_RECENT_FILES
    if (recentFiles.length > MAX_RECENT_FILES) {
        recentFiles = recentFiles.slice(0, MAX_RECENT_FILES);
    }

    await set("recentFiles", recentFiles);
};

export const openRecentFile = async (fileName: string): Promise<boolean> => {
    const recentFiles = await getRecentFiles();
    const recentFile = recentFiles.find(rf => rf.name === fileName);

    if (!recentFile) {
        return false;
    }

    fileHandle = recentFile.handle;
    return await openFileHandle();
};

const openFileHandle = async() => {
    if (!fileHandle) {
        return false;
    }
    if (!await ensurePermission(fileHandle)) {
        return false;
    }
    const file = await fileHandle.getFile();
    const reader = new FileReader();
    reader.onload = (e) => {
        onOpen(e.target?.result as string);
    };
    reader.readAsText(file);
    return true;
};

const ensurePermission = async (handle: FileSystemFileHandle) => {
    const opts: FileSystemHandlePermissionDescriptor = { mode: "readwrite" };

    let perm = await handle.queryPermission(opts);
    if (perm === "granted") return true;

    perm = await handle.requestPermission(opts);
    return perm === "granted";
};

export const saveFile = async (data: string): Promise<boolean> => {
    if (hasFileSystemAccess() && fileHandle) {
        // Modern API - save to file handle
        const writable = await fileHandle.createWritable();
        await writable.write(data);
        await writable.close();
        return true;
    } else {
        // Fallback - trigger download
        downloadString(data, currentFileName || "game.squiffy");
        return true;
    }
};