import type { SavedGame } from "./types.js";

// A player's saved games for one story, which the Saved games dialog lists. Each has an id, and
// an optional name the player gave it.
export interface SaveSlot {
    id: number;
    name: string | null;
    save: SavedGame;
}

export interface SaveSlots {
    // Newest first
    list(): Promise<SaveSlot[]>;
    get(id: number): Promise<SaveSlot | null>;
    // Saves to a new slot
    add(save: SavedGame, name: string | null): Promise<SaveSlot>;
    // Replaces a slot's save, keeping its name
    overwrite(id: number, save: SavedGame): Promise<void>;
    // A null or empty name makes the save unnamed again
    rename(id: number, name: string | null): Promise<void>;
    delete(id: number): Promise<void>;
}

interface SlotRecord {
    key: string;
    id: number;
    name: string | null;
    save: SavedGame;
}

const DATABASE = "squiffy-saves";
const STORE = "saves";

const newestFirst = (a: SaveSlot, b: SaveSlot) =>
    b.save.savedAt.localeCompare(a.save.savedAt) || b.id - a.id;

const toSlot = (record: SlotRecord): SaveSlot => ({ id: record.id, name: record.name, save: record.save });

const cleanName = (name: string | null) => name?.trim() || null;

function request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function done(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

// Saved games kept in the browser's IndexedDB, under key, so each story has its own. IndexedDB
// rather than localStorage, as a save has all the text on screen, and localStorage only holds a
// few megabytes for everything on the site.
export function indexedDbSaveSlots(key: string): SaveSlots {
    let database: Promise<IDBDatabase> | undefined;

    const open = () => database ??= new Promise((resolve, reject) => {
        const req = indexedDB.open(DATABASE, 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(STORE, { keyPath: ["key", "id"] });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
            database = undefined;
            reject(req.error);
        };
    });

    const range = () => IDBKeyRange.bound([key, -Infinity], [key, Infinity]);

    const transaction = async (mode: IDBTransactionMode) =>
        (await open()).transaction(STORE, mode).objectStore(STORE);

    const get = async (id: number): Promise<SlotRecord | undefined> =>
        request((await transaction("readonly")).get([key, id]) as IDBRequest<SlotRecord | undefined>);

    const put = async (record: SlotRecord) => {
        const store = await transaction("readwrite");
        store.put(record);
        await done(store.transaction);
    };

    // Asks the browser not to clear the saves when it's short of space. It may say no.
    let persistRequested = false;
    const requestPersistence = () => {
        if (persistRequested) return;
        persistRequested = true;
        navigator.storage?.persist?.().catch(() => {});
    };

    return {
        async list() {
            const records = await request((await transaction("readonly")).getAll(range()) as IDBRequest<SlotRecord[]>);
            return records.map(toSlot).sort(newestFirst);
        },
        async get(id) {
            const record = await get(id);
            return record ? toSlot(record) : null;
        },
        async add(save, name) {
            const keys = await request((await transaction("readonly")).getAllKeys(range()));
            const id = keys.reduce<number>((max, k) => Math.max(max, (k as [string, number])[1]), 0) + 1;
            const record = { key, id, name: cleanName(name), save };
            await put(record);
            requestPersistence();
            return toSlot(record);
        },
        async overwrite(id, save) {
            const record = await get(id);
            await put({ key, id, name: record?.name ?? null, save });
        },
        async rename(id, name) {
            const record = await get(id);
            if (record) await put({ ...record, name: cleanName(name) });
        },
        async delete(id) {
            const store = await transaction("readwrite");
            store.delete([key, id]);
            await done(store.transaction);
        },
    };
}

// Saved games kept in memory, which are gone when the page is: for tests, and somewhere to save
// when IndexedDB isn't there
export function memorySaveSlots(): SaveSlots {
    const slots = new Map<number, SaveSlot>();
    let nextId = 1;
    const copy = (slot: SaveSlot): SaveSlot => structuredClone(slot);
    return {
        async list() {
            return [...slots.values()].map(copy).sort(newestFirst);
        },
        async get(id) {
            const slot = slots.get(id);
            return slot ? copy(slot) : null;
        },
        async add(save, name) {
            const slot = { id: nextId++, name: cleanName(name), save: structuredClone(save) };
            slots.set(slot.id, slot);
            return copy(slot);
        },
        async overwrite(id, save) {
            slots.set(id, { id, name: slots.get(id)?.name ?? null, save: structuredClone(save) });
        },
        async rename(id, name) {
            const slot = slots.get(id);
            if (slot) slot.name = cleanName(name);
        },
        async delete(id) {
            slots.delete(id);
        },
    };
}
