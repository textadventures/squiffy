// The open project: where it's stored, its main file, and the files open in the editor.
//
// A project is a ProjectFileSystem from @textadventures/project-fs plus its main .squiffy file
// (#118). With a squiffy.json project file (#361), the main file is the one it names, and every
// .squiffy file in the folder is part of the story. Without one, the main file is the one
// remembered in the browser, which @imports the others. A project comes from one of:
//   - a folder on disk, opened with File System Access (Chromium browsers)
//   - a story kept in the browser's origin-private file system (every modern browser):
//     New, and Open file, which imports a .squiffy file into a new one
//   - in the Electron desktop app (#276), a folder on disk through project-fs's Electron bridge.
//     There are no stories in the browser there: New makes a folder, and Open file opens a file's folder.
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
import { newStoryDialog, newStoryText } from "./new-story.js";
import { needsBackup } from "./backup.js";
import { changedPaths, readDisk, reconcile } from "./disk-changes.js";
import { convertTwineFile, TWINE_FILE_PATTERN, twineImportMessage } from "./twine-import.js";
import { openNextStoryOnMap } from "./map-layout.js";
import { convertQuestFile, findQuestGame, QUEST_FILE_PATTERN, questImportMessage } from "./quest-import.js";

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

// Kept beside each story in the browser, in OPFS (stories/<id>/meta.json)
export interface BrowserStoryMeta {
    title: string;
    mainFile: string;
    lastOpened: number;
    // When the author last changed a file, and when they last downloaded the project or
    // dismissed the reminder to (backup.ts)
    lastEdited?: number;
    backupReminderResolved?: number;
}

// A folder's id is its place in the recent folders list (recent.ts)
export type ProjectSource = { kind: "browser"; id: string } | { kind: "folder"; id: string };

export const browserStories = new OpfsProjectStore<BrowserStoryMeta>({ baseDir: "stories" });

// The desktop app's bridges, or null in a browser
const desktop = desktopApi();
export const isDesktop = desktop !== null;

export const canOpenFolders = isDesktop || hasFileSystemAccess();

// A file open in the editor, with its own unsaved text
class OpenFile {
    readonly path: string;
    text = $state("");
    // The editor's last known version of the file on disk: what it last saved or read
    savedText = $state("");
    saving = $state(false);
    saveError = $state<string | null>(null);
    dirty = $derived(this.text !== this.savedText);
    // Changed outside the editor while it has unsaved changes: the text on disk, until the author
    // picks which to keep (disk-changes.ts)
    conflict = $state<string | null>(null);
    // Deleted outside the editor
    deleted = $state(false);
    // Not saved, even by Save, while there's a conflict or it's deleted
    held = $derived(this.conflict !== null || this.deleted);

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
        this.scheduleSave();
    }

    private scheduleSave() {
        clearTimeout(this.autosaveTimer);
        this.autosaveTimer = setTimeout(() => void this.save(), AUTOSAVE_DELAY_MS);
    }

    // Saves now. Saves run one at a time, so a slow write can't land after a later one. With
    // `force`, writes even if there's a conflict or the file was deleted.
    save(force = false): Promise<void> {
        clearTimeout(this.autosaveTimer);
        this.saveQueue = this.saveQueue.then(() => this.write(force));
        return this.saveQueue;
    }

    // Looks at the file on disk, after it's been changed outside the editor (or might have been),
    // and reloads it or holds it (disk-changes.ts). In the save queue, so it doesn't race a save.
    checkDisk(): Promise<void> {
        this.saveQueue = this.saveQueue.then(async () => {
            const disk = await readDisk(this.project.fs, this.path);
            if (disk !== undefined) this.diskIs(disk);
        });
        return this.saveQueue;
    }

    private diskIs(disk: string | null) {
        const action = reconcile(this.text, this.savedText, disk);
        const wasHeld = this.held;
        this.deleted = action.kind === "deleted";
        this.conflict = action.kind === "conflict" ? action.text : null;
        if (action.kind === "reload") {
            this.savedText = action.text;
            this.text = action.text;
        } else if (action.kind === "saved") {
            this.savedText = action.text;
        }
        // Changes made while it was held can be saved now
        if (wasHeld && !this.held && this.dirty) this.scheduleSave();
    }

    // After a conflict, the author picks the text on disk
    reload() {
        if (this.conflict === null) return;
        this.savedText = this.conflict;
        this.text = this.conflict;
        this.conflict = null;
    }

    // After a conflict or a deletion, the author picks the text in the editor
    keepMine(): Promise<void> {
        return this.save(true);
    }

    private async write(force: boolean) {
        if (this.held && !force) return;
        if (!force && this.text === this.savedText && !this.saveError) return;
        // Last line of defence, for a change the watcher missed (or a file system that can't be
        // watched): don't write over a file that's changed since the editor last saved or read it
        if (!force) {
            const disk = await readDisk(this.project.fs, this.path);
            if (disk !== undefined && disk !== this.savedText) {
                this.diskIs(disk);
                if (this.held || !this.dirty) return;
            }
        }
        const text = this.text;
        this.saving = true;
        try {
            await this.project.fs.write(this.path, text);
            this.savedText = text;
            this.saveError = null;
            this.conflict = null;
            const recreated = this.deleted;
            this.deleted = false;
            // Saved again after being deleted outside the editor: back in the file list
            if (recreated) await this.project.refreshFiles();
            // The language service reads .squiffy files from their editors, but anything else,
            // such as squiffy.json, from the project
            if (recreated || !this.path.toLowerCase().endsWith(".squiffy")) this.project.onFileChanged?.(this.path);
            await this.project.touch(true);
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

// Why a file isn't being saved, for the bar above its editor and when it's closed
export function heldMessage(file: OpenFile): string {
    return file.deleted
        ? `${file.path} has been deleted outside the editor, and has changes here that aren't saved.`
        : `${file.path} has been changed outside the editor, and has changes here that aren't saved.`;
}

class OpenProject {
    fs: ProjectFileSystem;
    source: ProjectSource;
    // The main file remembered in the browser (a browser story's meta.json, or the recent folders list),
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

    // For a story kept in the browser, from its meta.json: see needsBackup
    lastEdited = $state<number | undefined>(undefined);
    backupReminderResolved = $state<number | undefined>(undefined);
    get showBackupReminder(): boolean {
        return this.source.kind === "browser" && needsBackup(this, Date.now());
    }

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
    //
    // A squiffy.json also makes every .css and .js file part of the story, so pass the ones that
    // are part of it now (the ones it @imports), as `pageFiles`, and the others are excluded.
    async createProjectFile(main: string, exclude: string[] = [], pageFiles: string[] = []): Promise<SetterConversion> {
        const paths = this.files.map(f => f.path);
        const all = paths.includes(main) ? paths : [...paths, main];
        const inPage = new Set(pageFiles);
        const unused = getStoryFiles({ version: 1, main, exclude }, all);
        exclude = [...exclude, ...[...unused.stylesheets, ...unused.scripts].filter(path => !inPage.has(path))];
        const story = getStoryFiles({ version: 1, main, exclude }, all);
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

    // Leaves a .squiffy, .css or .js file out of the story, or puts it back, by editing squiffy.json's
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

    // Saves and closes a tab, showing its neighbour if it was the one showing. If the file was
    // changed or deleted outside the editor while it had unsaved changes, asks which to keep.
    async close(path: string) {
        const file = this.fileAt(path);
        if (!file) return;
        if (file.held && file.dirty) {
            const choice = await chooseDialog(`${heldMessage(file)} Keep your changes?`, [
                { label: "Cancel", value: null },
                { label: "Discard them", value: "discard", danger: true },
                { label: file.deleted ? "Save it again" : "Keep my changes", value: "keep" },
            ]);
            if (!choice) return;
            if (choice === "keep") await file.keepMine();
        } else {
            await file.save();
        }
        const index = this.openFiles.indexOf(file);
        if (index < 0) return;
        file.stop();
        this.openFiles.splice(index, 1);
        if (this.activePath === path) {
            this.activePath = this.openFiles[Math.min(index, this.openFiles.length - 1)]?.path ?? "";
        }
    }

    // Moves a file's tab so it's at index in the tab order (counting before it's moved)
    moveTab(path: string, index: number) {
        const from = this.openFiles.findIndex(f => f.path === path);
        if (from < 0) return;
        const to = Math.max(0, Math.min(from < index ? index - 1 : index, this.openFiles.length - 1));
        if (to === from) return;
        const [file] = this.openFiles.splice(from, 1);
        this.openFiles.splice(to, 0, file);
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
        await this.touch(true);
        this.onFileChanged?.(path);
    }

    // Adds or replaces a file, e.g. an image
    async writeFile(path: string, data: Uint8Array) {
        await this.fs.write(path, data);
        await this.refreshFiles();
        await this.touch(true);
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
        await this.touch(true);
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
        await this.touch(true);
        this.onFileChanged?.(path);
    }

    // Records the main file and when the project was last used (and, with `edited`, changed): in
    // a browser story's meta.json, with its title, or in the recent folders list
    async touch(edited = false) {
        if (this.source.kind === "folder") {
            if (desktop) await desktop.desktop.recent.update(this.source.id, this.storedMainFile);
            else await updateRecentFolder(this.source.id, this.storedMainFile);
            return;
        }
        const now = Date.now();
        if (edited) this.lastEdited = now;
        await browserStories.setMeta(this.source.id, {
            title: this.title,
            mainFile: this.storedMainFile,
            lastOpened: now,
            lastEdited: this.lastEdited,
            backupReminderResolved: this.backupReminderResolved,
        });
    }

    // After downloading the project, or dismissing the reminder to
    async resolveBackupReminder() {
        if (this.source.kind !== "browser") return;
        this.backupReminderResolved = Date.now();
        await this.touch();
    }

    // ── Changes made outside the editor ─────────────────────────────────────
    // By another program, such as an AI agent working on the story, a text editor or git. A
    // file system that can be watched (a folder in the desktop app) reports them as they happen;
    // otherwise (a folder opened in the browser) the editor looks when its window gets the focus.
    // Either way, open files are reloaded, or held if they have unsaved changes (disk-changes.ts).

    private unwatch: (() => void) | undefined;
    private diskQueue: Promise<void> = Promise.resolve();

    watch() {
        this.unwatch ??= this.fs.watch?.(changes => void this.filesChanged(changes.map(c => c.path)));
    }

    // After the file system reports changes
    filesChanged(paths: string[]): Promise<void> {
        return this.queueDiskWork(async () => {
            await this.refreshFiles();
            for (const path of new Set(paths)) {
                await this.fileAt(path)?.checkDisk();
                this.onFileChanged?.(path);
            }
        });
    }

    // When the window gets the focus, in case anything's changed that the file system didn't
    // report: files added or deleted, files not open whose modified time has changed, and open
    // files whose text has changed
    checkDisk(): Promise<void> {
        return this.queueDiskWork(async () => {
            const before = this.files;
            await this.refreshFiles();
            const changed = new Set(changedPaths(before, this.files).filter(path => !this.isOpen(path)));
            for (const file of [...this.openFiles]) {
                const savedText = file.savedText;
                const deleted = file.deleted;
                await file.checkDisk();
                if (file.savedText !== savedText || file.deleted !== deleted) changed.add(file.path);
            }
            for (const path of changed) this.onFileChanged?.(path);
        });
    }

    private queueDiskWork(work: () => Promise<void>): Promise<void> {
        this.diskQueue = this.diskQueue.then(work).catch(() => {
            // The folder may have gone (e.g. a removable drive): editing goes on regardless
        });
        return this.diskQueue;
    }

    // Open files changed or deleted outside the editor while they had unsaved changes
    get heldFiles(): OpenFile[] {
        return this.openFiles.filter(f => f.held && f.dirty);
    }

    closeAll() {
        this.unwatch?.();
        this.unwatch = undefined;
        for (const f of this.openFiles) f.stop();
    }
}

export { OpenProject };

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
async function start(fs: ProjectFileSystem, source: ProjectSource, storedMainFile: string, meta?: BrowserStoryMeta | null) {
    const opened = new OpenProject(fs, source, (await projectMainFile(fs)) ?? storedMainFile);
    if (meta?.title) opened.title = meta.title;
    opened.lastEdited = meta?.lastEdited;
    opened.backupReminderResolved = meta?.backupReminderResolved;
    await opened.refreshFiles();
    // A squiffy.json whose main file is missing still leaves something to open
    await opened.open((await fs.exists(opened.mainFile)) ? opened.mainFile : opened.storedMainFile);
    setCurrent(opened);
    opened.watch();
    await opened.touch();
}

// Saves and closes the open project, if any
export async function closeProject(): Promise<void> {
    if (!current) return;
    // Files changed or deleted outside the editor while they had unsaved changes aren't saved,
    // unless the author says to
    for (const file of current.heldFiles) {
        const keep = await confirmDialog(`${heldMessage(file)} Keep your changes?`, {
            cancelLabel: "Discard them",
            confirmLabel: file.deleted ? "Save it again" : "Keep my changes",
        });
        if (keep) await file.keepMine();
    }
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

// A new story in the browser with one .squiffy file, and a squiffy.json naming it. It's a copy,
// and has a squiffy.json, so its setters are converted to Squiffy 7's rules (#373).
async function createBrowserStory(mainFile: string, text: string): Promise<string> {
    const id = crypto.randomUUID();
    const fs = await browserStories.create(id, { title: "", mainFile, lastOpened: Date.now() });
    const conversion = convertSetters(text);
    text = conversion.script;
    const message = setterConversionMessage({ converted: conversion.converted, problems: conversion.problems.map(p => `line ${p.line}`) });
    if (message) showToast(message, "info", 12000);
    await fs.write(mainFile, text);
    await fs.write(PROJECT_FILENAME, formatProjectFile({ main: mainFile }));
    return id;
}

export async function newBrowserStory(): Promise<string> {
    return createBrowserStory(DEFAULT_MAIN_FILE, NEW_STORY);
}

export async function openBrowserStory(id: string): Promise<void> {
    const meta = await browserStories.getMeta(id);
    const fs = await browserStories.open(id);
    const mainFile = (await projectMainFile(fs)) ?? meta?.mainFile ?? DEFAULT_MAIN_FILE;
    // Say so, rather than quietly opening an empty story in its place
    if (!(await fs.exists(mainFile))) throw new Error(`its story file, ${mainFile}, is missing.`);
    await start(fs, { kind: "browser", id }, mainFile, meta);
}

export async function deleteBrowserStory(id: string): Promise<void> {
    if (current?.source.kind === "browser" && current.source.id === id) setCurrent(null);
    await browserStories.delete(id);
}

export async function listBrowserStories() {
    const list = await browserStories.listProjects();
    return list.sort((a, b) => (b.meta?.lastOpened ?? 0) - (a.meta?.lastOpened ?? 0));
}

// A new story in the browser with one .squiffy file, e.g. unsaved work from the 6.x editor. Returns its id.
export async function browserStoryFromText(fileName: string | undefined, text: string): Promise<string> {
    const name = fileName && /^[^/\\:*?"<>|]+\.squiffy$/i.test(fileName) ? fileName : DEFAULT_MAIN_FILE;
    return createBrowserStory(name, text);
}

// Imports a .squiffy file, a project zip (from Download project), or a Twine story or Quest
// gamebook, on its own or in a zip (converted, if the author says to), into a new story in the browser. Returns its id,
// or null if they cancel.
export async function importFile(file: File): Promise<string | null> {
    if (QUEST_FILE_PATTERN.test(file.name)) {
        const converted = await convertQuestFile(file.name, new Uint8Array(await file.arrayBuffer()));
        if (!converted) return null;
        const id = crypto.randomUUID();
        const fs = await browserStories.create(id, { title: converted.title, mainFile: converted.mainFile, lastOpened: Date.now() });
        for (const [path, content] of converted.files) await fs.write(path, content);
        showToast(questImportMessage(converted), "info", 12000);
        return id;
    }
    if (TWINE_FILE_PATTERN.test(file.name)) {
        const converted = await convertTwineFile(file.name, await file.text());
        if (!converted) return null;
        const id = crypto.randomUUID();
        const fs = await browserStories.create(id, { title: converted.title, mainFile: converted.mainFile, lastOpened: Date.now() });
        for (const [path, text] of converted.files) await fs.write(path, text);
        showToast(twineImportMessage(converted), "info", 12000);
        openNextStoryOnMap();
        return id;
    }
    if (file.name.toLowerCase().endsWith(".zip")) {
        const story = await readZip(file.name, new Uint8Array(await file.arrayBuffer()));
        if (!story) return null;
        const id = crypto.randomUUID();
        const fs = await browserStories.create(id, { title: story.title, mainFile: story.mainFile, lastOpened: Date.now() });
        for (const [path, data] of story.files) await fs.write(path, data);
        if (story.message) showToast(story.message, "info", 12000);
        return id;
    }
    const text = await file.text();
    // Keep the file's name when it's a valid project path, else fall back to the default
    const name = /^[^/\\:*?"<>|]+\.squiffy$/i.test(file.name) ? file.name : DEFAULT_MAIN_FILE;
    return createBrowserStory(name, text);
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
const QUEST_FILES: FileTypeFilter[] = [{ description: "Quest gamebooks", extensions: [".quest", ".aslx"], mimeType: "application/octet-stream" }];

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
// unpacked into a folder the author chooses, and a Twine story or Quest gamebook is converted into one
export async function pickDesktopFile(): Promise<PickedFolder | null> {
    // On macOS, a dialog with several filters only allows the first one's files until the
    // author picks another from its Format menu, so the first filter takes them all
    const filters = [...SQUIFFY_FILES, ...ZIP_FILES, ...TWINE_FILES, ...QUEST_FILES];
    const all: FileTypeFilter = { description: "All supported files", extensions: filters.flatMap(f => f.extensions) };
    const picked = await desktopOrThrow().opener.openFile({ title: "Open a story file", filters: [all, ...filters] });
    if (!picked) return null;
    const { fs, mainFile } = picked;
    if (mainFile.toLowerCase().endsWith(".zip")) {
        const data = await fs.read(mainFile);
        await fs.release();
        return unpackZip(mainFile, data);
    }
    if (QUEST_FILE_PATTERN.test(mainFile)) {
        const data = await fs.read(mainFile);
        await fs.release();
        const converted = await convertQuestFile(mainFile, data);
        if (!converted) return null;
        const folder = await writeIntoNewFolder(`the Squiffy version of ${mainFile}`, converted.files, converted.mainFile);
        if (folder) showToast(questImportMessage(converted), "info", 12000);
        return folder;
    }
    if (TWINE_FILE_PATTERN.test(mainFile)) {
        const text = new TextDecoder().decode(await fs.read(mainFile));
        await fs.release();
        const converted = await convertTwineFile(mainFile, text);
        if (!converted) return null;
        const folder = await writeIntoNewFolder(`the Squiffy version of ${mainFile}`, converted.files, converted.mainFile);
        if (folder) {
            showToast(twineImportMessage(converted), "info", 12000);
            openNextStoryOnMap();
        }
        return folder;
    }
    return { fs, mainFile: (await projectMainFile(fs)) ?? mainFile };
}

async function unpackZip(zipName: string, data: Uint8Array): Promise<PickedFolder | null> {
    const story = await readZip(zipName, data);
    if (!story) return null;
    const folder = story.message
        ? await writeIntoNewFolder(`the Squiffy version of ${zipName}`, story.files, story.mainFile)
        : await writeIntoNewFolder(zipName, story.files, story.mainFile, { title: `Choose a folder to unpack ${zipName} into`, buttonLabel: "Unpack here" });
    if (folder && story.message) showToast(story.message, "info", 12000);
    return folder;
}

// The story in a zip: a Squiffy project (from Download project), or a Quest gamebook or Twine
// story, converted if the author says to (with a message to show once it's saved). Null if they
// cancel.
async function readZip(zipName: string, data: Uint8Array): Promise<{
    files: Map<string, Uint8Array | string>, mainFile: string, title: string, message?: string,
} | null> {
    const { readProjectZip, zipMainFile, zipTwineFile } = await import("./export.js");
    const files = readProjectZip(data);
    const mainFile = zipMainFile(files);
    if (mainFile) return { files, mainFile, title: "" };
    if (findQuestGame(files.keys())) {
        const converted = await convertQuestFile(zipName, data);
        return converted && { ...converted, message: questImportMessage(converted) };
    }
    const twineFile = zipTwineFile(files);
    if (twineFile) {
        const converted = await convertTwineFile(zipName, new TextDecoder().decode(files.get(twineFile)));
        if (converted) openNextStoryOnMap();
        return converted && { ...converted, message: twineImportMessage(converted) };
    }
    throw new Error(`There's no Squiffy story, Quest gamebook or Twine story in ${zipName}.`);
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

// New story: the author names it, and it's made in a new folder of that name (newStoryDialog),
// with a story file and a squiffy.json
export async function pickDesktopNewStory(): Promise<PickedFolder | null> {
    const { projectFs } = desktopOrThrow();
    const created = await newStoryDialog();
    if (!created) return null;
    const fs = new ElectronFileSystem(projectFs, created.root);
    await fs.write(DEFAULT_MAIN_FILE, newStoryText(NEW_STORY, created.title));
    await fs.write(PROJECT_FILENAME, formatProjectFile({ main: DEFAULT_MAIN_FILE }));
    return { fs, mainFile: DEFAULT_MAIN_FILE };
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
// `pageFiles` are the .css and .js files that are part of the story now: see createProjectFile.
export async function offerProjectFile(p: OpenProject, options: { main: string; adding?: string; pageFiles: string[] }): Promise<ProjectOffer> {
    const { main, adding, pageFiles } = options;
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

    const conversion = await p.createProjectFile(main, exclude, pageFiles);
    const converted = setterConversionMessage(conversion);
    showToast(`Added ${PROJECT_FILENAME}, which makes this folder one story: every .squiffy, .css and .js file in it is part of the story, starting from the main file (★). Use a file's ⋯ menu to leave it out.${converted ? ` ${converted}` : ""}`, "info", 12000);
    return "created";
}
