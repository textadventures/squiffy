// Work left in the 6.x editor, which ran at the same address. It kept unsaved work in IndexedDB
// (idb-keyval's default store, key "autosave"), which the home page offers to open in the browser.
import { del, get } from "idb-keyval";

export interface LegacyAutoSave {
    content: string;
    timestamp: number;
    title?: string;
    fileName?: string;
}

export async function getLegacyAutoSave(): Promise<LegacyAutoSave | null> {
    try {
        const saved = await get<LegacyAutoSave>("autosave");
        return saved && typeof saved.content === "string" && saved.content.trim() ? saved : null;
    } catch {
        return null;
    }
}

export async function clearLegacyAutoSave(): Promise<void> {
    try {
        await del("autosave");
    } catch {
        // Nothing to clear
    }
}
