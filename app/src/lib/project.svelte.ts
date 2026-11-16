// The open project: where it's stored, its main file, and the files open in the editor.
//
// A project is a ProjectFileSystem from @textadventures/project-fs plus a pointer to its main
// .squiffy file, which @imports the others (#118). It comes from one of:
//   - a folder on disk, opened with File System Access (Chromium browsers)
//   - a local draft, kept in the browser's origin-private file system (every modern browser):
//     New, and Open file, which imports a .squiffy file into a new draft
// The Electron desktop app (#276) will add a third, through project-fs's Electron bridge.
//
// Each open file saves on its own, shortly after typing stops, as in Quest Viva, and Save
// (Ctrl+S) saves them all at once.
import {
    DirectoryHandleFileSystem, OpfsProjectStore, basename, findFiles, fsaOpener, hasFileSystemAccess, moveFile,
    type FileEntry, type FileTypeFilter, type ProjectFileSystem,
} from "@textadventures/project-fs";
import { chooseDialog } from "./confirm.js";
import { findRecentFolder, hasPermission, rememberFolder, updateRecentFolder } from "./recent.js";

export const SQUIFFY_FILES: FileTypeFilter[] = [
    { description: "Squiffy stories", extensions: [".squiffy"], mimeType: "text/plain" },
];

const DEFAULT_MAIN_FILE = "story.squiffy";
const AUTOSAVE_DELAY_MS = 1000;

export const NEW_STORY = `@title New Story

Start writing! Each choice is a [[new section]]: put double square brackets around some text to link to a section.

[[new section]]:

Sections can also have passages, which add text without moving the story on. Click this [passage link], and then carry on to the [[next section]].

[passage link]:

This is the text for the passage.

[[next section]]:

When a new section appears, any passage links in the previous section that weren't clicked are disabled.
`;

// Kept beside each draft in OPFS (projects/<id>/meta.json)
export interface DraftMeta {
    title: string;
    mainFile: string;
    lastOpened: number;
}

// A folder's id is its place in the recent folders list (recent.ts)
export type ProjectSource = { kind: "draft"; id: string } | { kind: "folder"; id: string };

export const drafts = new OpfsProjectStore<DraftMeta>({ baseDir: "drafts" });

export const canOpenFolders = hasFileSystemAccess();

// A file open in the editor, with its own unsaved text
class OpenFile {
    readonly path: string;
    text = $state("");
    savedText = $state("");
    saving = $state(false);
    saveError = $state<string | null>(null);
    dirty = $derived(this.text !== this.savedText);

    private autosaveTimer: ReturnType<typeof setTimeout> | undefined;
    private saveQueue: Promise<void> = Promise.resolve();

    constructor(private readonly project: OpenProject, path: string, text: string) {
        this.path = path;
        this.text = text;
        this.savedText = text;
    }

    setText(text: string) {
        if (text === this.text) return;
        this.text = text;
        clearTimeout(this.autosaveTimer);
        this.autosaveTimer = setTimeout(() => void this.save(), AUTOSAVE_DELAY_MS);
    }

    // Saves now. Saves run one at a time, so a slow write can't land after a later one.
    save(): Promise<void> {
        clearTimeout(this.autosaveTimer);
        this.saveQueue = this.saveQueue.then(() => this.write());
        return this.saveQueue;
    }

    private async write() {
        const text = this.text;
        if (text === this.savedText && !this.saveError) return;
        this.saving = true;
        try {
            await this.project.fs.write(this.path, text);
            this.savedText = text;
            this.saveError = null;
            await this.project.touch();
        } catch (err) {
            this.saveError = err instanceof Error ? err.message : String(err);
        } finally {
            this.saving = false;
        }
    }

    stop() {
        clearTimeout(this.autosaveTimer);
    }
}

export type { OpenFile };

class OpenProject {
    fs: ProjectFileSystem;
    source: ProjectSource;
    mainFile = $state("");
    title = $state("");
    // Every file in the project, from the last refreshFiles()
    files = $state<FileEntry[]>([]);
    // Open files, in tab order, and which one is showing
    openFiles = $state<OpenFile[]>([]);
    activePath = $state("");

    active = $derived(this.openFiles.find(f => f.path === this.activePath) ?? null);
    dirty = $derived(this.openFiles.some(f => f.dirty));
    saving = $derived(this.openFiles.some(f => f.saving));
    saveError = $derived(this.openFiles.find(f => f.saveError)?.saveError ?? null);

    // Told about every file this project adds, changes on disk, deletes or renames (after the
    // file list is up to date), so the language service and the preview can catch up
    onFileChanged: ((path: string) => void) | undefined;

    constructor(fs: ProjectFileSystem, source: ProjectSource, mainFile: string) {
        this.fs = fs;
        this.source = source;
        this.mainFile = mainFile;
        this.title = source.kind === "folder" ? fs.name : "";
    }

    // The name to show: the story's @title, else the folder or main file's name
    get displayName(): string {
        return this.title || (this.source.kind === "folder" ? this.fs.name : this.mainFile);
    }

    isOpen(path: string) {
        return this.openFiles.some(f => f.path === path);
    }

    fileAt(path: string): OpenFile | undefined {
        return this.openFiles.find(f => f.path === path);
    }

    async refreshFiles() {
        this.files = await this.fs.list();
    }

    // Opens a file in a tab (or goes to its tab) and shows it
    async open(path: string) {
        if (!this.isOpen(path)) {
            const text = await this.fs.readText(path);
            if (!this.isOpen(path)) this.openFiles.push(new OpenFile(this, path, text));
        }
        this.activePath = path;
    }

    // Saves and closes a tab, showing its neighbour if it was the one showing
    async close(path: string) {
        const index = this.openFiles.findIndex(f => f.path === path);
        if (index < 0) return;
        const file = this.openFiles[index];
        await file.save();
        file.stop();
        this.openFiles.splice(index, 1);
        if (this.activePath === path) {
            this.activePath = this.openFiles[Math.min(index, this.openFiles.length - 1)]?.path ?? "";
        }
    }

    save(): Promise<void> {
        return Promise.all(this.openFiles.map(f => f.save())).then(() => undefined);
    }

    setTitle(title: string) {
        if (title === this.title) return;
        this.title = title;
        void this.touch();
    }

    setMainFile(path: string) {
        this.mainFile = path;
        void this.touch();
    }

    // Creates a file and opens it. Fails if it exists.
    async createFile(path: string, text: string) {
        if (await this.fs.exists(path)) throw new Error(`There's already a file called ${path}.`);
        await this.fs.write(path, text);
        await this.refreshFiles();
        this.onFileChanged?.(path);
    }

    // Adds or replaces a file, e.g. an image
    async writeFile(path: string, data: Uint8Array) {
        await this.fs.write(path, data);
        await this.refreshFiles();
        this.onFileChanged?.(path);
    }

    async renameFile(from: string, to: string) {
        const open = this.fileAt(from);
        if (open) await open.save();
        await moveFile(this.fs, from, to);
        if (open) {
            const index = this.openFiles.indexOf(open);
            open.stop();
            this.openFiles[index] = new OpenFile(this, to, open.text);
            if (this.activePath === from) this.activePath = to;
        }
        if (this.mainFile === from) this.setMainFile(to);
        await this.refreshFiles();
        this.onFileChanged?.(from);
        this.onFileChanged?.(to);
    }

    async deleteFile(path: string) {
        const open = this.fileAt(path);
        if (open) {
            open.stop();
            this.openFiles.splice(this.openFiles.indexOf(open), 1);
            if (this.activePath === path) this.activePath = this.openFiles[0]?.path ?? "";
        }
        await this.fs.delete(path);
        await this.refreshFiles();
        this.onFileChanged?.(path);
    }

    // Records the main file and when the project was last used: in a draft's meta.json, with its
    // title, or in the recent folders list
    async touch() {
        if (this.source.kind === "folder") {
            await updateRecentFolder(this.source.id, this.mainFile);
            return;
        }
        await drafts.setMeta(this.source.id, {
            title: this.title,
            mainFile: this.mainFile,
            lastOpened: Date.now(),
        });
    }

    closeAll() {
        for (const f of this.openFiles) f.stop();
    }
}

export type { OpenProject };

let current = $state<OpenProject | null>(null);

export const project = {
    get current() {
        return current;
    },
};

function setCurrent(next: OpenProject | null) {
    current?.closeAll();
    current = next;
}

// Opens a project at its main file
async function start(fs: ProjectFileSystem, source: ProjectSource, mainFile: string, title = "") {
    const opened = new OpenProject(fs, source, mainFile);
    if (title) opened.title = title;
    await Promise.all([opened.open(mainFile), opened.refreshFiles()]);
    setCurrent(opened);
    await opened.touch();
}

// Saves and closes the open project, if any
export async function closeProject(): Promise<void> {
    if (!current) return;
    await current.save();
    setCurrent(null);
}

async function createDraft(mainFile: string, text: string): Promise<string> {
    const id = crypto.randomUUID();
    const fs = await drafts.create(id, { title: "", mainFile, lastOpened: Date.now() });
    await fs.write(mainFile, text);
    return id;
}

export async function newDraft(): Promise<string> {
    return createDraft(DEFAULT_MAIN_FILE, NEW_STORY);
}

export async function openDraft(id: string): Promise<void> {
    const meta = await drafts.getMeta(id);
    const fs = await drafts.open(id);
    const mainFile = meta?.mainFile ?? DEFAULT_MAIN_FILE;
    // Say so, rather than quietly opening an empty story in its place
    if (!(await fs.exists(mainFile))) throw new Error(`its story file, ${mainFile}, is missing.`);
    await start(fs, { kind: "draft", id }, mainFile, meta?.title);
}

export async function deleteDraft(id: string): Promise<void> {
    if (current?.source.kind === "draft" && current.source.id === id) setCurrent(null);
    await drafts.delete(id);
}

export async function listDrafts() {
    const list = await drafts.listProjects();
    return list.sort((a, b) => (b.meta?.lastOpened ?? 0) - (a.meta?.lastOpened ?? 0));
}

// A new draft with one .squiffy file, e.g. unsaved work from the 6.x editor. Returns its id.
export async function draftFromText(fileName: string | undefined, text: string): Promise<string> {
    const name = fileName && /^[^/\\:*?"<>|]+\.squiffy$/i.test(fileName) ? fileName : DEFAULT_MAIN_FILE;
    return createDraft(name, text);
}

// Imports a .squiffy file, or a project zip (from Download project), into a new draft. Returns
// the draft's id.
export async function importFile(file: File): Promise<string> {
    if (file.name.toLowerCase().endsWith(".zip")) {
        const { readProjectZip, guessMainFile } = await import("./export.js");
        const files = readProjectZip(new Uint8Array(await file.arrayBuffer()));
        const mainFile = guessMainFile(files.keys());
        if (!mainFile) throw new Error(`There's no .squiffy file in ${file.name}.`);
        const id = crypto.randomUUID();
        const fs = await drafts.create(id, { title: "", mainFile, lastOpened: Date.now() });
        for (const [path, data] of files) await fs.write(path, data);
        return id;
    }
    const text = await file.text();
    // Keep the file's name when it's a valid project path, else fall back to the default
    const name = /^[^/\\:*?"<>|]+\.squiffy$/i.test(file.name) ? file.name : DEFAULT_MAIN_FILE;
    return createDraft(name, text);
}

// Opens a folder with File System Access, and the main .squiffy file in it, and adds it to the
// recent folders. Returns the folder's id there, or null if the user cancels.
export async function openFolder(): Promise<string | null> {
    const fs = await fsaOpener.openFolder({ id: "squiffy-project" });
    if (!fs) return null;
    const mainFile = await chooseMainFile(fs);
    if (!mainFile) return null;
    const id = await rememberFolder(fs.root, mainFile);
    await start(fs, { kind: "folder", id }, mainFile);
    return id;
}

// Opens a folder from the recent folders list. With `ask`, the browser may ask for permission
// again, which must be from a click; without it, this only succeeds if the folder can be used
// already (e.g. after a reload). Returns false if it can't be opened.
export async function openRecentFolder(id: string, ask: boolean): Promise<boolean> {
    const folder = await findRecentFolder(id);
    if (!folder) return false;
    const fs = ask ? await fsaOpener.reopen(folder.handle) : (await hasPermission(folder.handle)) ? new DirectoryHandleFileSystem(folder.handle) : null;
    if (!fs) return false;
    let mainFile: string | null = folder.mainFile;
    if (!(await fs.exists(mainFile))) {
        // Moved or deleted since: ask again
        mainFile = await chooseMainFile(fs);
        if (!mainFile) return false;
    }
    await start(fs, { kind: "folder", id }, mainFile);
    return true;
}

export { forgetFolder, listRecentFolders, type RecentFolder } from "./recent.js";

// The main .squiffy file in a folder: the only one, or the one the author picks, or a new one
async function chooseMainFile(fs: ProjectFileSystem): Promise<string | null> {
    const files = (await findFiles(fs, SQUIFFY_FILES)).map(f => f.path);
    let mainFile: string | null;
    if (files.length === 0) {
        const create = await chooseDialog(`There's no .squiffy file in ${fs.name}. Start a new story there?`, [
            { label: "Cancel", value: false },
            { label: `Create ${DEFAULT_MAIN_FILE}`, value: true },
        ]);
        if (!create) return null;
        await fs.write(DEFAULT_MAIN_FILE, NEW_STORY);
        mainFile = DEFAULT_MAIN_FILE;
    } else if (files.length === 1) {
        mainFile = files[0];
    } else {
        // Top-level files first: the main file is usually beside the files it @imports
        const sorted = [...files].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
        mainFile = await chooseDialog(
            `${fs.name} has more than one .squiffy file. Which is the main one?`,
            sorted.slice(0, 8).map(path => ({ label: path, value: path })),
        );
    }
    return mainFile;
}

// Downloads a file, with the editor's unsaved text if it's open
export async function downloadFile(path: string): Promise<void> {
    if (!current) return;
    const open = current.fileAt(path);
    const blob = open ? new Blob([open.text], { type: "text/plain" }) : new Blob([await current.fs.read(path) as BlobPart]);
    const { saveBlob } = await import("./export.js");
    saveBlob(blob, basename(path));
}

export { relativePath, storyPath } from "./paths.js";
