// The open project: where it's stored, its main file, and the files open in the editor.
//
// A project is a ProjectFileSystem from @textadventures/project-fs plus its main .squiffy file
// (#118). With a squiffy.json project file (#361), the main file is the one it names, and every
// .squiffy file in the folder is part of the story. Without one, the main file is the one
// remembered in the browser, which @imports the others. A project comes from one of:
//   - a folder on disk, opened with File System Access (Chromium browsers)
//   - a local draft, kept in the browser's origin-private file system (every modern browser):
//     New, and Open file, which imports a .squiffy file into a new draft
//   - in the Electron desktop app (#276), a folder on disk through project-fs's Electron bridge.
//     There are no drafts there: New makes a folder, and Open file opens a file's folder.
//
// Each open file saves on its own, shortly after typing stops, as in Quest Viva, and Save
// (Ctrl+S) saves them all at once.
import {
    DirectoryHandleFileSystem, ElectronFileSystem, OpfsProjectStore, basename, electronOpener, findFiles, fsaOpener,
    hasFileSystemAccess, moveFile,
    type FileEntry, type FileTypeFilter, type ProjectFileSystem,
} from "@textadventures/project-fs";
import {
    convertSetters, formatProjectFile, getStoryFiles, isExcluded, parseProjectFile, PROJECT_FILENAME, updateProjectFile,
    type MapPositions, type ProjectFile, type StoryFiles,
} from "squiffy-compiler";
import { checklistDialog, chooseDialog, confirmDialog } from "./confirm.js";
import { showToast } from "./toast.js";
import { findRecentFolder, forgetFolder as forgetBrowserFolder, hasPermission, listRecentFolders as listBrowserFolders, rememberFolder, updateRecentFolder } from "./recent.js";
import { desktopApi } from "./desktop.js";
import { convertTwineFile, TWINE_FILE_PATTERN, twineImportMessage } from "./twine-import.js";

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
@end

When a new section appears, any passage links in the previous section that weren't clicked are disabled.

This section has no links, so the story ends here. The @end above says that's on purpose. Without it, the editor would warn you about a dead end.
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

// The desktop app's bridges, or null in a browser
const desktop = desktopApi();
export const isDesktop = desktop !== null;

export const canOpenFolders = isDesktop || hasFileSystemAccess();

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
            // The language service reads .squiffy files from their editors, but anything else,
            // such as squiffy.json, from the project
            if (!this.path.toLowerCase().endsWith(".squiffy")) this.project.onFileChanged?.(this.path);
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
    // The main file remembered in the browser (a draft's meta.json, or the recent folders list),
    // used when there's no squiffy.json
    storedMainFile = $state("");
    title = $state("");
    // Every file in the project, from the last refreshFiles()
    files = $state<FileEntry[]>([]);
    // Open files, in tab order, and which one is showing
    openFiles = $state<OpenFile[]>([]);
    activePath = $state("");

    // squiffy.json's saved text, or null if there isn't one: from its editor if it's open,
    // otherwise as read by the last refreshFiles()
    private diskProjectText = $state<string | null>(null);
    projectText = $derived(this.openFiles.find(f => f.path === PROJECT_FILENAME)?.savedText ?? this.diskProjectText);
    // The project file, if there's a valid one. Its presence turns on folder mode, where every
    // .squiffy file not excluded is part of the story.
    projectFile = $derived.by((): ProjectFile | null => {
        if (this.projectText === null) return null;
        const parsed = parseProjectFile(this.projectText);
        return parsed.success ? parsed.project : null;
    });
    // squiffy.json's main file wins over the one remembered in the browser
    mainFile = $derived(this.projectFile?.main ?? this.storedMainFile);
    // In folder mode, which .squiffy files are part of the story and which are excluded
    storyFiles = $derived<StoryFiles | null>(this.projectFile ? getStoryFiles(this.projectFile, this.files.map(f => f.path)) : null);

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
        this.storedMainFile = mainFile;
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
        const files = await this.fs.list();
        let projectText: string | null = null;
        if (files.some(f => f.path === PROJECT_FILENAME)) {
            try {
                projectText = await this.fs.readText(PROJECT_FILENAME);
            } catch {
                // Treated as missing
            }
        }
        this.files = files;
        this.diskProjectText = projectText;
    }

    isExcluded(path: string): boolean {
        return this.storyFiles?.excluded.includes(path) ?? false;
    }

    // Writes a text file, through its editor if it's open, so it keeps its undo history
    async writeText(path: string, text: string) {
        const open = this.fileAt(path);
        if (open) {
            open.setText(text);
            await open.save();
        } else {
            await this.fs.write(path, text);
        }
        await this.refreshFiles();
        this.onFileChanged?.(path);
    }

    // Changes squiffy.json, keeping anything else in it. Returns false if it isn't a JSON object.
    private async updateProject(changes: { main?: string; exclude?: string[]; map?: MapPositions }): Promise<boolean> {
        if (this.projectText === null) return false;
        const text = updateProjectFile(this.projectText, changes);
        if (text === undefined) return false;
        await this.writeText(PROJECT_FILENAME, text);
        return true;
    }

    // Creates squiffy.json, making the folder one story. A story with a squiffy.json uses
    // Squiffy 7's rules for @set and link setters (#373), so the setters in the story's .squiffy
    // files are converted first, through their editors if they're open, so it can be undone.
    async createProjectFile(main: string, exclude: string[] = []): Promise<SetterConversion> {
        const paths = this.files.map(f => f.path);
        const story = getStoryFiles({ version: 1, main, exclude }, paths.includes(main) ? paths : [...paths, main]);
        const conversion: SetterConversion = { converted: 0, problems: [] };
        for (const path of [main, ...story.included]) {
            const open = this.fileAt(path);
            let text: string;
            try {
                text = open ? open.text : await this.fs.readText(path);
            } catch {
                continue;
            }
            const result = convertSetters(text);
            if (result.converted) await this.writeText(path, result.script);
            conversion.converted += result.converted;
            conversion.problems.push(...result.problems.map(problem => `${path} line ${problem.line}`));
        }
        await this.writeText(PROJECT_FILENAME, formatProjectFile({ main, exclude }));
        this.setStoredMainFile(main);
        return conversion;
    }

    // Saves where the author has put sections and passages on the story map, in squiffy.json.
    // Returns false if there's no squiffy.json, or it can't be read.
    async setMapPositions(map: MapPositions): Promise<boolean> {
        if (!this.projectFile) return false;
        return this.updateProject({ map });
    }

    // Leaves a .squiffy file out of the story, or puts it back, by editing squiffy.json's
    // "exclude". Returns why it couldn't, if it couldn't.
    async setExcluded(path: string, excluded: boolean): Promise<string | null> {
        const project = this.projectFile;
        if (!project) return `There's no ${PROJECT_FILENAME}.`;
        let exclude = [...project.exclude];
        if (excluded) {
            if (!isExcluded(path, exclude)) exclude.push(path);
        } else {
            exclude = exclude.filter(pattern => pattern.replace(/^\.\//, "") !== path);
            const patterns = exclude.filter(pattern => isExcluded(path, [pattern]));
            if (patterns.length) {
                return `${path} is excluded by ${patterns.map(p => `"${p}"`).join(" and ")} in ${PROJECT_FILENAME}. Edit it there to include this file.`;
            }
        }
        return (await this.updateProject({ exclude })) ? null : `${PROJECT_FILENAME} couldn't be read. Fix it, then try again.`;
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

    private setStoredMainFile(path: string) {
        this.storedMainFile = path;
        void this.touch();
    }

    // Makes another file the main one: in squiffy.json, if there is one, and in the browser
    async setMainFile(path: string) {
        if (this.projectText !== null && !(await this.updateProject({ main: path }))) {
            showToast(`${PROJECT_FILENAME} couldn't be read, so its main file wasn't changed. Fix it, then try again.`);
        }
        this.setStoredMainFile(path);
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
        await this.refreshFiles();
        if (this.mainFile === from || this.storedMainFile === from) await this.setMainFile(to);
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
            if (desktop) await desktop.desktop.recent.update(this.source.id, this.storedMainFile);
            else await updateRecentFolder(this.source.id, this.storedMainFile);
            return;
        }
        await drafts.setMeta(this.source.id, {
            title: this.title,
            mainFile: this.storedMainFile,
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
    // The desktop app's main process holds each folder it's approved until it's released
    if (current && current !== next && current.fs instanceof ElectronFileSystem) void current.fs.release().catch(() => {});
    current = next;
}

// The main file named by a project's squiffy.json, if it has a valid one and that file exists
export async function projectMainFile(fs: ProjectFileSystem): Promise<string | null> {
    try {
        if (!(await fs.exists(PROJECT_FILENAME))) return null;
        const parsed = parseProjectFile(await fs.readText(PROJECT_FILENAME));
        if (!parsed.success) {
            showToast(parsed.error);
            return null;
        }
        if (await fs.exists(parsed.project.main)) return parsed.project.main;
        showToast(`${PROJECT_FILENAME} names ${parsed.project.main} as the main file, but it doesn't exist.`);
    } catch {
        // Treated as no project file
    }
    return null;
}

// Opens a project at its main file: squiffy.json's, or else the one remembered in the browser
async function start(fs: ProjectFileSystem, source: ProjectSource, storedMainFile: string, title = "") {
    const opened = new OpenProject(fs, source, (await projectMainFile(fs)) ?? storedMainFile);
    if (title) opened.title = title;
    await opened.refreshFiles();
    // A squiffy.json whose main file is missing still leaves something to open
    await opened.open((await fs.exists(opened.mainFile)) ? opened.mainFile : opened.storedMainFile);
    setCurrent(opened);
    await opened.touch();
}

// Saves and closes the open project, if any
export async function closeProject(): Promise<void> {
    if (!current) return;
    await current.save();
    setCurrent(null);
}

// What converting a story's setters to Squiffy 7's rules did (#373): how many setters changed,
// and where the ones that couldn't be converted are
export interface SetterConversion {
    converted: number;
    problems: string[];
}

// What to tell the author about a conversion, or "" if nothing happened
export function setterConversionMessage(conversion: SetterConversion): string {
    const { converted, problems } = conversion;
    if (!converted && !problems.length) return "";
    let message = converted
        ? `Converted ${converted} setter${converted === 1 ? "" : "s"} to Squiffy 7's rules, where text is in quotes and attributes don't need "@" (e.g. @set weapon = "sword").`
        : "";
    if (problems.length) {
        message += `${message ? " " : ""}${problems.length === 1 ? "One setter" : `${problems.length} setters`} couldn't be converted, and may need changing by hand: ${problems.slice(0, 3).join(", ")}${problems.length > 3 ? ", ..." : ""}.`;
    }
    return message;
}

// A new draft with one .squiffy file, and a squiffy.json naming it. A draft is a copy, and has a
// squiffy.json, so its setters are converted to Squiffy 7's rules (#373).
async function createDraft(mainFile: string, text: string): Promise<string> {
    const id = crypto.randomUUID();
    const fs = await drafts.create(id, { title: "", mainFile, lastOpened: Date.now() });
    const conversion = convertSetters(text);
    text = conversion.script;
    const message = setterConversionMessage({ converted: conversion.converted, problems: conversion.problems.map(p => `line ${p.line}`) });
    if (message) showToast(message, "info", 12000);
    await fs.write(mainFile, text);
    await fs.write(PROJECT_FILENAME, formatProjectFile({ main: mainFile }));
    return id;
}

export async function newDraft(): Promise<string> {
    return createDraft(DEFAULT_MAIN_FILE, NEW_STORY);
}

export async function openDraft(id: string): Promise<void> {
    const meta = await drafts.getMeta(id);
    const fs = await drafts.open(id);
    const mainFile = (await projectMainFile(fs)) ?? meta?.mainFile ?? DEFAULT_MAIN_FILE;
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

// Imports a .squiffy file, a project zip (from Download project), or a Twine story (converted,
// if the author says to), into a new draft. Returns the draft's id, or null if they cancel.
export async function importFile(file: File): Promise<string | null> {
    if (TWINE_FILE_PATTERN.test(file.name)) {
        const converted = await convertTwineFile(file.name, await file.text());
        if (!converted) return null;
        const id = crypto.randomUUID();
        const fs = await drafts.create(id, { title: converted.title, mainFile: converted.mainFile, lastOpened: Date.now() });
        for (const [path, text] of converted.files) await fs.write(path, text);
        showToast(twineImportMessage(converted), "info", 12000);
        return id;
    }
    if (file.name.toLowerCase().endsWith(".zip")) {
        const { readProjectZip, zipMainFile } = await import("./export.js");
        const files = readProjectZip(new Uint8Array(await file.arrayBuffer()));
        const mainFile = zipMainFile(files);
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
    if (desktop) {
        const picked = await pickDesktopFolder();
        return picked && openPicked(picked);
    }
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
    if (desktop) {
        const picked = await pickDesktopRecent(id);
        if (picked) await openPicked(picked);
        return !!picked;
    }
    const folder = await findRecentFolder(id);
    if (!folder) return false;
    const fs = ask ? await fsaOpener.reopen(folder.handle) : (await hasPermission(folder.handle)) ? new DirectoryHandleFileSystem(folder.handle) : null;
    if (!fs) return false;
    let mainFile: string | null = (await projectMainFile(fs)) ?? folder.mainFile;
    if (!(await fs.exists(mainFile))) {
        // Moved or deleted since: ask again
        mainFile = await chooseMainFile(fs);
        if (!mainFile) return false;
    }
    await start(fs, { kind: "folder", id }, mainFile);
    return true;
}

// A folder in the recent folders list: kept by the browser, or by the desktop app
export interface RecentFolder {
    id: string;
    name: string;
    mainFile: string;
    lastOpened: number;
    // The folder's path, in the desktop app
    displayPath?: string;
}

export async function listRecentFolders(): Promise<RecentFolder[]> {
    return desktop ? desktop.desktop.recent.list() : listBrowserFolders();
}

export async function forgetFolder(id: string): Promise<void> {
    if (desktop) await desktop.desktop.recent.forget(id);
    else await forgetBrowserFolder(id);
}

// The desktop app (#276). Opening is in two steps, picking and then opening, so that the editor
// can save and close the story that's open only once the author has picked another.

// A folder picked in the desktop app, not opened yet
export interface PickedFolder {
    fs: ElectronFileSystem;
    mainFile: string;
    // Its id in the recent folders list, if it came from there
    recentId?: string;
}

function desktopOrThrow() {
    if (!desktop) throw new Error("Only in the desktop app");
    return { ...desktop, opener: electronOpener(desktop.projectFs) };
}

const ZIP_FILES: FileTypeFilter[] = [{ description: "Project zip files", extensions: [".zip"], mimeType: "application/zip" }];
const TWINE_FILES: FileTypeFilter[] = [{ description: "Twine stories", extensions: [".twee", ".tw", ".html", ".htm"], mimeType: "text/html" }];

// Open folder
export async function pickDesktopFolder(): Promise<PickedFolder | null> {
    const fs = await desktopOrThrow().opener.openFolder({ title: "Open a story folder", buttonLabel: "Open" });
    if (!fs) return null;
    const mainFile = await chooseMainFile(fs);
    if (!mainFile) {
        await fs.release();
        return null;
    }
    return { fs, mainFile };
}

// Open file: a .squiffy file opens its folder, a project zip (from Download project) is
// unpacked into a folder the author chooses, and a Twine story is converted into one
export async function pickDesktopFile(): Promise<PickedFolder | null> {
    // On macOS, a dialog with several filters only allows the first one's files until the
    // author picks another from its Format menu, so the first filter takes them all
    const filters = [...SQUIFFY_FILES, ...ZIP_FILES, ...TWINE_FILES];
    const all: FileTypeFilter = { description: "All supported files", extensions: filters.flatMap(f => f.extensions) };
    const picked = await desktopOrThrow().opener.openFile({ title: "Open a story file", filters: [all, ...filters] });
    if (!picked) return null;
    const { fs, mainFile } = picked;
    if (mainFile.toLowerCase().endsWith(".zip")) {
        const data = await fs.read(mainFile);
        await fs.release();
        return unpackZip(mainFile, data);
    }
    if (TWINE_FILE_PATTERN.test(mainFile)) {
        const text = new TextDecoder().decode(await fs.read(mainFile));
        await fs.release();
        const converted = await convertTwineFile(mainFile, text);
        if (!converted) return null;
        const folder = await writeIntoNewFolder(`the Squiffy version of ${mainFile}`, converted.files, converted.mainFile);
        if (folder) showToast(twineImportMessage(converted), "info", 12000);
        return folder;
    }
    return { fs, mainFile: (await projectMainFile(fs)) ?? mainFile };
}

async function unpackZip(zipName: string, data: Uint8Array): Promise<PickedFolder | null> {
    const { readProjectZip, zipMainFile } = await import("./export.js");
    const files = readProjectZip(data);
    const mainFile = zipMainFile(files);
    if (!mainFile) throw new Error(`There's no .squiffy file in ${zipName}.`);
    return writeIntoNewFolder(zipName, files, mainFile, { title: `Choose a folder to unpack ${zipName} into`, buttonLabel: "Unpack here" });
}

// Writes files into a folder the author chooses, asking before replacing any that are there
async function writeIntoNewFolder(
    what: string, files: Map<string, Uint8Array | string>, mainFile: string,
    dialog = { title: `Choose a folder for ${what}`, buttonLabel: "Save here" },
): Promise<PickedFolder | null> {
    const fs = await desktopOrThrow().opener.pickNewRoot({ title: dialog.title, message: dialog.title, buttonLabel: dialog.buttonLabel });
    if (!fs) return null;
    const existing = new Set((await fs.list()).map(f => f.path));
    const clashes = [...files.keys()].filter(path => existing.has(path));
    if (clashes.length && !(await confirmDialog(
        `${fs.name} already has ${clashes.length === 1 ? clashes[0] : `${clashes.length} of the files in ${what}`}. Replace ${clashes.length === 1 ? "it" : "them"}?`,
        { confirmLabel: "Replace", danger: true },
    ))) {
        await fs.release();
        return null;
    }
    for (const [path, content] of files) await fs.write(path, content);
    return { fs, mainFile };
}

// New story: a folder the author chooses (or makes, in the dialog), with a story file and a
// squiffy.json. If the folder has a story already, it offers to open that instead.
export async function pickDesktopNewStory(): Promise<PickedFolder | null> {
    const fs = await desktopOrThrow().opener.pickNewRoot({
        title: "Choose a folder for the new story",
        message: "Choose or create a folder for the new story",
        buttonLabel: "Create story",
    });
    if (!fs) return null;
    let mainFile: string | null;
    if ((await findFiles(fs, SQUIFFY_FILES)).length > 0) {
        const open = await confirmDialog(`${fs.name} already has a story in it. Open it?`, { confirmLabel: "Open it" });
        mainFile = open ? await chooseMainFile(fs) : null;
    } else {
        await fs.write(DEFAULT_MAIN_FILE, NEW_STORY);
        if (!(await fs.exists(PROJECT_FILENAME))) await fs.write(PROJECT_FILENAME, formatProjectFile({ main: DEFAULT_MAIN_FILE }));
        mainFile = DEFAULT_MAIN_FILE;
    }
    if (!mainFile) {
        await fs.release();
        return null;
    }
    return { fs, mainFile };
}

// A folder from the recent folders list. Null if it's not there or has gone.
export async function pickDesktopRecent(id: string): Promise<PickedFolder | null> {
    const { desktop: api, projectFs } = desktopOrThrow();
    const info = await api.recent.open(id);
    if (!info) return null;
    const fs = new ElectronFileSystem(projectFs, info);
    let mainFile: string | null = (await projectMainFile(fs)) ?? info.mainFile;
    // Moved or deleted since, or a folder the OS opened, with no main file yet
    if (!mainFile || !(await fs.exists(mainFile))) mainFile = await chooseMainFile(fs);
    if (!mainFile) {
        await fs.release();
        return null;
    }
    return { fs, mainFile, recentId: id };
}

// Opens a picked folder and puts it at the top of the recent folders. Returns its id there.
export async function openPicked(picked: PickedFolder): Promise<string> {
    const { desktop: api } = desktopOrThrow();
    const id = picked.recentId ?? await api.recent.remember(picked.fs.rootId, picked.mainFile);
    await start(picked.fs, { kind: "folder", id }, picked.mainFile);
    return id;
}

// The main .squiffy file in a folder: the one its squiffy.json names, the only one, or the one
// the author picks, or a new one
async function chooseMainFile(fs: ProjectFileSystem): Promise<string | null> {
    const fromProject = await projectMainFile(fs);
    if (fromProject) return fromProject;
    const files = (await findFiles(fs, SQUIFFY_FILES)).map(f => f.path);
    let mainFile: string | null;
    if (files.length === 0) {
        const create = await chooseDialog(`There's no .squiffy file in ${fs.name}. Start a new story there?`, [
            { label: "Cancel", value: false },
            { label: `Create ${DEFAULT_MAIN_FILE}`, value: true },
        ]);
        if (!create) return null;
        await fs.write(DEFAULT_MAIN_FILE, NEW_STORY);
        if (!(await fs.exists(PROJECT_FILENAME))) await fs.write(PROJECT_FILENAME, formatProjectFile({ main: DEFAULT_MAIN_FILE }));
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

// What happened when the editor offered to make a folder one story
export type ProjectOffer = "created" | "declined" | "cancelled";

// Offers to make the folder one story with a squiffy.json, when the author adds a second .squiffy
// file (`adding`) or makes another file the main one (`main`). If the folder already has other
// .squiffy files, the author is asked first and can leave some out, so files that belong to some
// other story are never pulled in without asking. Otherwise the file is created, with a note.
export async function offerProjectFile(p: OpenProject, options: { main: string; adding?: string }): Promise<ProjectOffer> {
    const { main, adding } = options;
    const squiffyFiles = p.files.map(f => f.path).filter(path => path.toLowerCase().endsWith(".squiffy"));
    const others = getStoryFiles({ version: 1, main, exclude: [] }, adding ? [...squiffyFiles, adding] : squiffyFiles)
        .included.filter(path => path !== adding);
    let exclude: string[] = [];

    if (others.length) {
        const total = others.length + 1 + (adding ? 1 : 0);
        const fixed = [main, ...(adding ? [adding] : [])];
        const result = await checklistDialog(
            `Make all ${total} .squiffy files in this folder part of this story?\n\n` +
            `This adds a ${PROJECT_FILENAME} project file, and then every .squiffy file is part of the story without an @import. Untick any that belong to something else.`,
            [
                ...fixed.map(path => ({ label: path === main ? `${path} (main file)` : path, checked: true, disabled: true })),
                ...others.map(path => ({ label: path, checked: true })),
            ],
            [
                { label: "Cancel", value: "cancelled" as const },
                { label: adding ? `No, just @import ${adding}` : "No, just change the main file", value: "declined" as const },
                { label: "Make one story", value: "created" as const },
            ],
        );
        if (!result || result.value === "cancelled") return "cancelled";
        if (result.value === "declined") return "declined";
        exclude = others.filter((_, i) => !result.checked[fixed.length + i]);
    }

    const conversion = await p.createProjectFile(main, exclude);
    const converted = setterConversionMessage(conversion);
    showToast(`Added ${PROJECT_FILENAME}, which makes this folder one story: every .squiffy file in it is part of the story, starting from the main file (★). Use a file's ⋯ menu to leave it out.${converted ? ` ${converted}` : ""}`, "info", 12000);
    return "created";
}
