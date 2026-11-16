// Folders opened with File System Access, so they can be opened again from the home page. The
// browser lets a folder's handle be kept in IndexedDB, but asks again for permission to use it
// in a later session, which needs a click (a user gesture).
import { createStore, get, set } from "idb-keyval";

export interface RecentFolder {
    id: string;
    name: string;
    mainFile: string;
    handle: FileSystemDirectoryHandle;
    lastOpened: number;
}

const MAX = 10;
const KEY = "folders";
const store = () => createStore("squiffy-recent", "recent");

export async function listRecentFolders(): Promise<RecentFolder[]> {
    try {
        return ((await get<RecentFolder[]>(KEY, store())) ?? []).sort((a, b) => b.lastOpened - a.lastOpened);
    } catch {
        // No IndexedDB (e.g. some private windows): there's just no list
        return [];
    }
}

async function save(list: RecentFolder[]) {
    try {
        await set(KEY, list.slice(0, MAX), store());
    } catch {
        // As above: the list is a convenience
    }
}

// Adds a folder (or brings it to the top, if it's the same folder as one already there).
// Returns its id.
export async function rememberFolder(handle: FileSystemDirectoryHandle, mainFile: string): Promise<string> {
    const list = await listRecentFolders();
    let existing: RecentFolder | undefined;
    for (const folder of list) {
        if (await folder.handle.isSameEntry(handle).catch(() => false)) existing = folder;
    }
    const entry: RecentFolder = {
        id: existing?.id ?? crypto.randomUUID(),
        name: handle.name,
        mainFile,
        handle,
        lastOpened: Date.now(),
    };
    await save([entry, ...list.filter(f => f !== existing)]);
    return entry.id;
}

export async function updateRecentFolder(id: string, mainFile: string) {
    const list = await listRecentFolders();
    const folder = list.find(f => f.id === id);
    if (!folder) return;
    folder.mainFile = mainFile;
    folder.lastOpened = Date.now();
    await save(list);
}

export async function forgetFolder(id: string) {
    await save((await listRecentFolders()).filter(f => f.id !== id));
}

export async function findRecentFolder(id: string): Promise<RecentFolder | undefined> {
    return (await listRecentFolders()).find(f => f.id === id);
}

// Whether the folder can be used without asking (e.g. it was opened earlier in this session)
export async function hasPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
    const h = handle as FileSystemDirectoryHandle & { queryPermission?(d: { mode: string }): Promise<PermissionState> };
    if (!h.queryPermission) return true;
    return (await h.queryPermission({ mode: "readwrite" })) === "granted";
}
