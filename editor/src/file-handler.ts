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

export const clearCurrentFile = () => {
    fileHandle = null;
    currentFileName = null;
};

export const getCurrentFileHandle = (): FileSystemFileHandle | null => {
    return fileHandle;
};

export const getCurrentFileName = (): string | null => {
    return currentFileName;
};

export const setCurrentFile = (handle: FileSystemFileHandle | null, fileName: string | null) => {
    fileHandle = handle;
    currentFileName = fileName;
};

export interface FileSelection {
    content: string;
    fileName: string;
}

const selectFileFallback = async (): Promise<FileSelection | null> => {
    return new Promise((resolve) => {
        const input = document.getElementById("file-input-fallback") as HTMLInputElement;
        if (!input) {
            resolve(null);
            return;
        }

        // Reset input to allow selecting same file again
        input.value = "";

        // Set up one-time event listener
        const handleChange = async (e: Event) => {
            const target = e.target as HTMLInputElement;
            const file = target.files?.[0];

            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    resolve({
                        content: e.target?.result as string,
                        fileName: file.name
                    });
                };
                reader.onerror = () => resolve(null);
                reader.readAsText(file);
            } else {
                // User cancelled
                resolve(null);
            }

            // Clean up listener
            input.removeEventListener("change", handleChange);
        };

        input.addEventListener("change", handleChange);
        input.click();
    });
};

export const selectFile = async (): Promise<FileSelection | null> => {
    try {
        if (hasFileSystemAccess()) {
            // Modern API - Chrome, Edge
            [fileHandle] = await window.showOpenFilePicker();
            await addToRecentFiles(fileHandle);

            if (!await ensurePermission(fileHandle)) {
                return null;
            }
            const file = await fileHandle.getFile();
            currentFileName = file.name;
            const content = await file.text();
            return { content, fileName: file.name };
        } else {
            // Fallback for Safari, Firefox
            const selection = await selectFileFallback();
            if (selection) {
                currentFileName = selection.fileName;
            }
            return selection;
        }
    } catch {
        // User cancelled or permission denied
        return null;
    }
};

export const openFile = async (): Promise<boolean> => {
    const selection = await selectFile();
    if (selection) {
        onOpen(selection.content);
        return true;
    }
    return false;
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
    currentFileName = file.name;
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

export const saveFileAs = async (data: string): Promise<boolean> => {
    if (hasFileSystemAccess()) {
        // Modern API - show save file picker
        try {
            const options: SaveFilePickerOptions = {
                types: [
                    {
                        description: "Squiffy Files",
                        accept: { "text/plain": [".squiffy"] },
                    },
                ],
                suggestedName: currentFileName || "game.squiffy",
            };

            fileHandle = await window.showSaveFilePicker(options);
            await addToRecentFiles(fileHandle);

            const writable = await fileHandle.createWritable();
            await writable.write(data);
            await writable.close();

            // Update current filename
            const file = await fileHandle.getFile();
            currentFileName = file.name;

            return true;
        } catch {
            // User cancelled
            return false;
        }
    } else {
        // Fallback - prompt for filename and download
        const newFileName = prompt("Save as:", currentFileName || "game.squiffy");
        if (newFileName) {
            currentFileName = newFileName;
            downloadString(data, newFileName);
            return true;
        }
        return false;
    }
};