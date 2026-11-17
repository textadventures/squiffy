import { randomUUID } from "node:crypto";
import { promises as fsp } from "node:fs";
import * as nodePath from "node:path";
import type { RecentFolderInfo } from "./api.js";

// The recent folders list, kept by the main process in a JSON file in the app's userData folder.
// It holds absolute paths, so it never takes one from the renderer: a folder gets into it only
// through a root the window already holds (project-fs's rootPath), or a file the OS opened.

export interface RecentEntry {
    id: string;
    path: string;
    mainFile: string;
    lastOpened: number;
}

const MAX = 10;

export class RecentFolders {
    private entries: RecentEntry[] | null = null;
    private writing: Promise<void> = Promise.resolve();

    constructor(private readonly file: string) {}

    private async load(): Promise<RecentEntry[]> {
        if (this.entries) return this.entries;
        try {
            const parsed: unknown = JSON.parse(await fsp.readFile(this.file, "utf8"));
            this.entries = Array.isArray(parsed) ? parsed.filter(isEntry) : [];
        } catch {
            this.entries = [];
        }
        return this.entries;
    }

    private save(entries: RecentEntry[]): Promise<void> {
        this.entries = entries.sort((a, b) => b.lastOpened - a.lastOpened).slice(0, MAX);
        const text = JSON.stringify(this.entries, null, 2);
        // One write at a time, so an older list can't land after a newer one
        this.writing = this.writing.then(async () => {
            await fsp.mkdir(nodePath.dirname(this.file), { recursive: true });
            await fsp.writeFile(this.file, text);
        }).catch(() => {
            // The list is a convenience: carry on without it
        });
        return this.writing;
    }

    async list(): Promise<RecentEntry[]> {
        return [...(await this.load())];
    }

    async find(id: unknown): Promise<RecentEntry | undefined> {
        return (await this.load()).find(e => e.id === id);
    }

    /** Adds a folder, or brings it to the top if it's there already. Returns its id. */
    async add(path: string, mainFile: string): Promise<string> {
        const entries = await this.load();
        const existing = entries.find(e => samePath(e.path, path));
        const entry: RecentEntry = { id: existing?.id ?? randomUUID(), path, mainFile, lastOpened: Date.now() };
        await this.save([entry, ...entries.filter(e => e !== existing)]);
        return entry.id;
    }

    async update(id: string, mainFile: string): Promise<void> {
        const entries = await this.load();
        const entry = entries.find(e => e.id === id);
        if (!entry) return;
        entry.mainFile = mainFile;
        entry.lastOpened = Date.now();
        await this.save([...entries]);
    }

    async forget(id: string): Promise<void> {
        await this.save((await this.load()).filter(e => e.id !== id));
    }

    async clear(): Promise<void> {
        await this.save([]);
    }
}

export function toInfo(entry: RecentEntry): RecentFolderInfo {
    return {
        id: entry.id,
        name: nodePath.basename(entry.path),
        displayPath: entry.path,
        mainFile: entry.mainFile,
        lastOpened: entry.lastOpened,
    };
}

function isEntry(value: unknown): value is RecentEntry {
    const e = value as RecentEntry;
    return !!e && typeof e.id === "string" && typeof e.path === "string" && nodePath.isAbsolute(e.path) &&
        typeof e.mainFile === "string" && typeof e.lastOpened === "number";
}

// macOS and Windows disks are usually case-insensitive
function samePath(a: string, b: string): boolean {
    return process.platform === "linux" ? a === b : a.toLowerCase() === b.toLowerCase();
}
