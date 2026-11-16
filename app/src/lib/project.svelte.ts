// The open project: where it's stored, its main file, and the text being edited.
//
// A project is a ProjectFileSystem from @textadventures/project-fs plus a pointer to its main
// .squiffy file. It comes from one of:
//   - a folder on disk, opened with File System Access (Chromium browsers)
//   - a local draft, kept in the browser's origin-private file system (every modern browser):
//     New, and Open file, which imports a .squiffy file into a new draft
// The Electron desktop app (#276) will add a third, through project-fs's Electron bridge.
//
// This milestone edits one file, the main one. Edits autosave shortly after typing stops, as in
// Quest Viva, and Save (Ctrl+S) saves at once.
import {
    OpfsProjectStore, fsaOpener, findFiles, hasFileSystemAccess, type FileTypeFilter, type ProjectFileSystem,
} from "@textadventures/project-fs";
import { chooseDialog } from "./confirm.js";

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

export type ProjectSource = { kind: "draft"; id: string } | { kind: "folder" };

export const drafts = new OpfsProjectStore<DraftMeta>({ baseDir: "drafts" });

export const canOpenFolders = hasFileSystemAccess();

class OpenProject {
    fs: ProjectFileSystem;
    source: ProjectSource;
    mainFile: string;

    text = $state("");
    savedText = $state("");
    title = $state("");
    saving = $state(false);
    saveError = $state<string | null>(null);
    dirty = $derived(this.text !== this.savedText);

    private autosaveTimer: ReturnType<typeof setTimeout> | undefined;
    private saveQueue: Promise<void> = Promise.resolve();

    constructor(fs: ProjectFileSystem, source: ProjectSource, mainFile: string, text: string) {
        this.fs = fs;
        this.source = source;
        this.mainFile = mainFile;
        this.text = text;
        this.savedText = text;
        this.title = source.kind === "folder" ? fs.name : "";
    }

    // The name to show: the story's @title, else the folder or file name
    get displayName(): string {
        return this.title || (this.source.kind === "folder" ? this.fs.name : this.mainFile);
    }

    setText(text: string) {
        if (text === this.text) return;
        this.text = text;
        clearTimeout(this.autosaveTimer);
        this.autosaveTimer = setTimeout(() => void this.save(), AUTOSAVE_DELAY_MS);
    }

    setTitle(title: string) {
        if (title === this.title) return;
        this.title = title;
        if (this.source.kind === "draft") void this.writeMeta();
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
            await this.fs.write(this.mainFile, text);
            this.savedText = text;
            this.saveError = null;
            if (this.source.kind === "draft") await this.writeMeta();
        } catch (err) {
            this.saveError = err instanceof Error ? err.message : String(err);
        } finally {
            this.saving = false;
        }
    }

    private async writeMeta() {
        if (this.source.kind !== "draft") return;
        await drafts.setMeta(this.source.id, {
            title: this.title,
            mainFile: this.mainFile,
            lastOpened: Date.now(),
        });
    }

    close() {
        clearTimeout(this.autosaveTimer);
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
    current?.close();
    current = next;
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
    const text = await fs.readText(mainFile);
    const opened = new OpenProject(fs, { kind: "draft", id }, mainFile, text);
    opened.title = meta?.title ?? "";
    setCurrent(opened);
    await drafts.setMeta(id, { title: opened.title, mainFile, lastOpened: Date.now() });
}

export async function deleteDraft(id: string): Promise<void> {
    if (current?.source.kind === "draft" && current.source.id === id) setCurrent(null);
    await drafts.delete(id);
}

export async function listDrafts() {
    const list = await drafts.listProjects();
    return list.sort((a, b) => (b.meta?.lastOpened ?? 0) - (a.meta?.lastOpened ?? 0));
}

// Imports a .squiffy file into a new draft. Returns the draft's id.
export async function importFile(file: File): Promise<string> {
    const text = await file.text();
    // Keep the file's name when it's a valid project path, else fall back to the default
    const name = /^[^/\\:*?"<>|]+\.squiffy$/i.test(file.name) ? file.name : DEFAULT_MAIN_FILE;
    return createDraft(name, text);
}

// Opens a folder with File System Access, and the main .squiffy file in it. Returns false if the
// user cancels.
export async function openFolder(): Promise<boolean> {
    const fs = await fsaOpener.openFolder({ id: "squiffy-project" });
    if (!fs) return false;
    const files = (await findFiles(fs, SQUIFFY_FILES)).map(f => f.path);
    let mainFile: string | null;
    if (files.length === 0) {
        const create = await chooseDialog(`There's no .squiffy file in ${fs.name}. Start a new story there?`, [
            { label: "Cancel", value: false },
            { label: `Create ${DEFAULT_MAIN_FILE}`, value: true },
        ]);
        if (!create) return false;
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
        if (!mainFile) return false;
    }
    const text = await fs.readText(mainFile);
    setCurrent(new OpenProject(fs, { kind: "folder" }, mainFile, text));
    return true;
}

// Downloads the main file, e.g. to keep a copy of a draft
export function downloadMainFile(): void {
    if (!current) return;
    const blob = new Blob([current.text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = current.mainFile.split("/").pop() ?? DEFAULT_MAIN_FILE;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
