import { promises as fsp } from "node:fs";
import * as nodePath from "node:path";

// Where New story makes a story's folder: <location>/<name>, as Quest Viva does. The location is
// Documents/Squiffy until the author picks another, and the last one a story was made in is
// remembered. The main process keeps it, so the renderer never sends a path: it asks for a new
// location through a dialog, and sends only the folder's name.

export type NewStoryFolderResult =
    | { ok: true; path: string }
    | { ok: false; reason: "exists" | "invalid-name" };

export class NewStoryLocation {
    // Picked in the dialog that's open, but not made a story in yet
    private pending: string | null = null;

    constructor(
        private readonly file: string,
        private readonly defaultPath: string,
    ) {}

    private async saved(): Promise<string | null> {
        try {
            const parsed = JSON.parse(await fsp.readFile(this.file, "utf8")) as { location?: unknown };
            return typeof parsed.location === "string" && nodePath.isAbsolute(parsed.location) ? parsed.location : null;
        } catch {
            return null;
        }
    }

    /** The location for a new dialog, forgetting one picked in a dialog that was cancelled */
    async start(): Promise<string> {
        this.pending = null;
        return this.current();
    }

    async current(): Promise<string> {
        return this.pending ?? await this.saved() ?? this.defaultPath;
    }

    pick(path: string): void {
        this.pending = path;
    }

    /** Makes <location>/<name>, and remembers the location */
    async createFolder(name: unknown): Promise<NewStoryFolderResult> {
        if (!isFolderName(name)) return { ok: false, reason: "invalid-name" };
        const location = await this.current();
        await fsp.mkdir(location, { recursive: true });
        const path = nodePath.join(location, name);
        try {
            await fsp.mkdir(path);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "EEXIST") return { ok: false, reason: "exists" };
            throw err;
        }
        this.pending = null;
        try {
            await fsp.writeFile(this.file, JSON.stringify({ location }));
        } catch {
            // Not worth failing over: it's only a default for next time
        }
        return { ok: true, path };
    }
}

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

// A name that's a single folder on every OS: what the editor's folderNameFor() makes, so this only
// turns away a renderer that sends something else
export function isFolderName(name: unknown): name is string {
    return typeof name === "string" && name.length > 0 && name.length <= 100 &&
        name === name.trim() && !name.endsWith(".") && !name.startsWith(".") &&
        // eslint-disable-next-line no-control-regex
        !/[<>:"/\\|?*\u0000-\u001f]/.test(name) && !RESERVED.test(name);
}
