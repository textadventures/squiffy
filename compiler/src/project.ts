// The squiffy.json project file, which makes a folder of .squiffy files one story:
//
//   { "version": 1, "main": "story.squiffy", "exclude": ["drafts/**"] }
//
// Without it, a story is its main file plus whatever that @imports. With it, the story is every
// .squiffy, .css and .js file in the folder and its subfolders, except those `exclude` matches:
// the main file first, then the rest in path order. These are the rules the CLI, the Vite plugin,
// the language service and the editor all share. They're pure functions, so each can supply its own file list.

export const PROJECT_FILENAME = "squiffy.json";

// The newest project file format this version of Squiffy understands. It counts the file
// format, not the Squiffy release, and only goes up when the meaning of a project changes.
export const PROJECT_FILE_VERSION = 1;

// Where the project file's JSON schema is published
export const PROJECT_SCHEMA_URL = "https://squiffystory.com/schema/squiffy.json";

export interface ProjectFile {
    version: number;
    // Identifies the story, whatever its title or files are called, so a player's saved game can
    // be loaded only into the story it came from. A new project file is given a random UUID.
    id?: string;
    // The story's main file, relative to the project file's folder, with "/" separators.
    main: string;
    // Glob patterns for .squiffy, .css and .js files that aren't part of the story, relative to
    // the project file's folder. "*" and "?" match within a folder name, "**" across folders, and
    // a pattern that matches a folder excludes everything in it.
    exclude: string[];
    // Where the author has put sections and passages on the editor's story map, if anywhere
    map?: MapPositions;
    // Whether the published story has a Back button for players. Undefined means it does.
    backButton?: boolean;
    // Whether the published story has a Save button, which opens the Saved games dialog.
    // Undefined means it does.
    saveButton?: boolean;
    // The published page's own text, such as the Restart button's tooltip, for a story in another
    // language. Anything left out is in English.
    strings?: PageStrings;
    // Passages in the master section that are always to hand: beside the story, or in a dialog
    // from a button in the header (#14, #443)
    panels?: Panel[];
}

// The icons a panel's button can have. The runtime has the same list (PANEL_ICONS).
export const PANEL_ICONS = ["bag", "person", "map", "help", "info", "list", "book", "star", "heart"] as const;
export type PanelIcon = typeof PANEL_ICONS[number];

// A panel, from squiffy.json's "panels". The runtime's Panel is the same.
export interface Panel {
    // A passage in the master section [[]], rendered again as the story goes on
    passage: string;
    // The button's text, or its tooltip if it has an icon
    label: string;
    // "side" shows it beside the story (or as a button, on a narrow screen). "button", or
    // leaving it out, shows it in a dialog from a button in the header.
    position?: "side" | "button";
    icon?: PanelIcon;
}

// The text on the published page around the story, by name. See PAGE_STRINGS for the English.
export type PageStringName = keyof typeof PAGE_STRINGS;
export type PageStrings = Partial<Record<PageStringName, string>>;

// The published page's text in English, which squiffy.json's "strings" can replace
export const PAGE_STRINGS = {
    back: "Back",
    restart: "Restart",
    restartConfirm: "Are you sure you want to restart?",
    switchToDark: "Switch to dark mode",
    switchToLight: "Switch to light mode",
    // The Saved games dialog, opened by the Save button. [name] and [time] are filled in.
    saves: "Saved games",
    saveName: "Name (optional)",
    save: "Save",
    noSaves: "No saved games yet.",
    savedGame: "Saved game",
    savedToday: "Today, [time]",
    savedYesterday: "Yesterday, [time]",
    load: "Load",
    loadConfirm: "Load \"[name]\"? You'll lose anything you've done since you last saved.",
    saveOptions: "Options for [name]",
    overwrite: "Overwrite",
    overwriteConfirm: "Overwrite \"[name]\"?",
    rename: "Rename",
    newName: "New name",
    saveToFile: "Save to file",
    loadFromFile: "Load from file",
    delete: "Delete",
    deleteConfirm: "Delete \"[name]\"? This can't be undone.",
    cancel: "Cancel",
    close: "Close",
    wrongStory: "This saved game is for a different story.",
    notASave: "This file isn't a saved game.",
    cantSave: "The game couldn't be saved. Try Save to file instead.",
} satisfies Record<string, string>;

// Positions on the story map, by section name, and passages by section and passage name. Only
// sections and passages the author has moved by hand are saved: the map lays out the rest.
export interface MapPositions {
    sections: Record<string, [number, number]>;
    passages: Record<string, Record<string, [number, number]>>;
}

export type ParsedProjectFile =
    | { success: true; project: ProjectFile }
    | { success: false; error: string };

// Parses and checks a squiffy.json. An error is a sentence to show the author as is.
export function parseProjectFile(text: string): ParsedProjectFile {
    const fail = (error: string): ParsedProjectFile => ({ success: false, error });
    let json: unknown;
    try {
        json = JSON.parse(text);
    }
    catch (e) {
        return fail(`${PROJECT_FILENAME} isn't valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!json || typeof json != "object" || Array.isArray(json)) {
        return fail(`${PROJECT_FILENAME} should contain an object, such as { "version": 1, "main": "story.squiffy" }.`);
    }
    const data = json as Record<string, unknown>;

    const version = data.version;
    if (version === undefined) {
        return fail(`${PROJECT_FILENAME} needs a "version", which should be ${PROJECT_FILE_VERSION}.`);
    }
    if (typeof version != "number" || !Number.isInteger(version) || version < 1) {
        return fail(`${PROJECT_FILENAME}'s "version" should be a whole number, such as ${PROJECT_FILE_VERSION}.`);
    }
    if (version > PROJECT_FILE_VERSION) {
        return fail(`This story's ${PROJECT_FILENAME} is version ${version}, which needs a newer version of Squiffy.`);
    }

    const main = data.main;
    if (main === undefined) {
        return fail(`${PROJECT_FILENAME} needs a "main" file, such as "main": "story.squiffy".`);
    }
    if (typeof main != "string" || !main.trim()) {
        return fail(`${PROJECT_FILENAME}'s "main" should be the name of a .squiffy file, such as "story.squiffy".`);
    }
    const mainPath = normalisePath(main);
    if (mainPath === null) {
        return fail(`${PROJECT_FILENAME}'s "main" should be a path inside the project's folder, not "${main}".`);
    }
    if (!mainPath.endsWith(".squiffy")) {
        return fail(`${PROJECT_FILENAME}'s "main" should be a .squiffy file, not "${main}".`);
    }

    const exclude = data.exclude ?? [];
    if (!Array.isArray(exclude) || exclude.some(pattern => typeof pattern != "string")) {
        return fail(`${PROJECT_FILENAME}'s "exclude" should be a list of file patterns, such as ["drafts/**"].`);
    }

    const id = data.id;
    if (id !== undefined && (typeof id != "string" || !id.trim())) {
        return fail(`${PROJECT_FILENAME}'s "id" should be text that identifies the story, such as "${EXAMPLE_ID}".`);
    }

    const backButton = data.backButton;
    if (backButton !== undefined && typeof backButton != "boolean") {
        return fail(`${PROJECT_FILENAME}'s "backButton" should be true or false.`);
    }

    const saveButton = data.saveButton;
    if (saveButton !== undefined && typeof saveButton != "boolean") {
        return fail(`${PROJECT_FILENAME}'s "saveButton" should be true or false.`);
    }

    const strings = data.strings;
    if (strings !== undefined && (!isObject(strings) || Object.values(strings).some(value => typeof value != "string"))) {
        return fail(`${PROJECT_FILENAME}'s "strings" should be an object of text, such as { "restart": "Recommencer" }.`);
    }

    const panels = parsePanels(data.panels);
    if (typeof panels == "string") return fail(panels);

    const map = parseMapPositions(data.map);
    return {
        success: true,
        project: {
            version, main: mainPath, exclude: exclude as string[],
            ...(id !== undefined ? { id: (id as string).trim() } : {}),
            ...(map ? { map } : {}),
            ...(backButton !== undefined ? { backButton } : {}),
            ...(saveButton !== undefined ? { saveButton } : {}),
            ...(strings !== undefined ? { strings: pickPageStrings(strings as Record<string, string>) } : {}),
            ...(panels !== undefined ? { panels } : {}),
        },
    };
}

// The page strings Squiffy knows about. Others are left out, so a story written for a newer Squiffy,
// with strings this one doesn't have, still builds.
function pickPageStrings(strings: Record<string, string>): PageStrings {
    return Object.fromEntries(Object.entries(strings).filter(([name]) => Object.prototype.hasOwnProperty.call(PAGE_STRINGS, name)));
}

// squiffy.json's "panels", or an error to show the author
function parsePanels(value: unknown): Panel[] | string | undefined {
    if (value === undefined) return undefined;
    const example = "{ \"passage\": \"inventory\", \"label\": \"Inventory\" }";
    if (!Array.isArray(value)) return `${PROJECT_FILENAME}'s "panels" should be a list, such as [${example}].`;
    const panels: Panel[] = [];
    for (const [i, item] of value.entries()) {
        const which = `${PROJECT_FILENAME}'s panel ${i + 1}`;
        if (!isObject(item)) return `${which} should be an object, such as ${example}.`;
        if (typeof item.passage != "string" || !item.passage.trim()) {
            return `${which} needs a "passage": the name of a passage in the master section [[]].`;
        }
        if (typeof item.label != "string" || !item.label.trim()) {
            return `${which} needs a "label", for its button, such as "Inventory".`;
        }
        if (item.position !== undefined && item.position !== "side" && item.position !== "button") {
            return `${which}'s "position" should be "side" or "button".`;
        }
        if (item.icon !== undefined && !(PANEL_ICONS as readonly unknown[]).includes(item.icon)) {
            return `${which}'s "icon" should be one of ${PANEL_ICONS.map(icon => `"${icon}"`).join(", ")}.`;
        }
        panels.push({
            passage: item.passage.trim(),
            label: item.label.trim(),
            ...(item.position !== undefined ? { position: item.position } : {}),
            ...(item.icon !== undefined ? { icon: item.icon as PanelIcon } : {}),
        });
    }
    return panels;
}

const EXAMPLE_ID = "0b7c6d9e-3f1a-4e2b-9c5d-8a7f6e5d4c3b";

const isPosition = (value: unknown): value is [number, number] =>
    Array.isArray(value) && value.length == 2 && value.every(n => typeof n == "number" && Number.isFinite(n));

const isObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value == "object" && !Array.isArray(value);

// The story map's positions. Only the editor uses them, so anything that isn't a position is
// left out rather than stopping the story from building.
function parseMapPositions(value: unknown): MapPositions | undefined {
    if (!isObject(value)) return undefined;
    const sections: MapPositions["sections"] = {};
    const passages: MapPositions["passages"] = {};
    if (isObject(value.sections)) {
        for (const [name, position] of Object.entries(value.sections)) {
            if (isPosition(position)) sections[name] = position;
        }
    }
    if (isObject(value.passages)) {
        for (const [section, byName] of Object.entries(value.passages)) {
            if (!isObject(byName)) continue;
            for (const [name, position] of Object.entries(byName)) {
                if (isPosition(position)) (passages[section] ??= {})[name] = position;
            }
        }
    }
    return { sections, passages };
}

// A project path with "/" separators and no "." segments, or null if it goes outside the folder
// or is absolute.
function normalisePath(path: string): string | null {
    const slashes = path.replace(/\\/g, "/");
    if (slashes.startsWith("/") || /^[a-zA-Z]:/.test(slashes)) return null;
    const parts: string[] = [];
    for (const part of slashes.split("/")) {
        if (part == "" || part == ".") continue;
        if (part == "..") return null;
        parts.push(part);
    }
    return parts.length ? parts.join("/") : null;
}

// "*" and "?" match within one path segment; "**" matches across segments.
export function globToRegExp(pattern: string): RegExp {
    let out = "";
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (c == "*") {
            if (pattern[i + 1] == "*") {
                i++;
                if (pattern[i + 1] == "/") {
                    i++;
                    out += "(?:.*/)?";
                }
                else {
                    out += ".*";
                }
            }
            else {
                out += "[^/]*";
            }
        }
        else if (c == "?") {
            out += "[^/]";
        }
        else {
            out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        }
    }
    return new RegExp(`^${out}$`);
}

// Whether `exclude` leaves a file out of the story: a pattern matches it or one of its folders.
export function isExcluded(path: string, exclude: string[]): boolean {
    const parts = path.split("/");
    return exclude.some(pattern => {
        const normalised = normalisePath(pattern.trim());
        if (normalised === null) return false;
        const regex = globToRegExp(normalised);
        for (let i = 1; i <= parts.length; i++) {
            if (regex.test(parts.slice(0, i).join("/"))) return true;
        }
        return false;
    });
}

// Folders whose files are never part of a story, whatever `exclude` says: node_modules, and
// folders whose names start with "." (.git, .vscode and the like).
export function isAlwaysSkipped(path: string): boolean {
    const folders = path.split("/").slice(0, -1);
    return folders.some(folder => folder == "node_modules" || folder.startsWith("."));
}

// The folder, next to squiffy.json, that the CLI builds a project's published files into. Its
// files are never part of the story.
export const BUILD_FOLDER = "build";

// The files that Squiffy 6, and Squiffy 7 without a squiffy.json, write next to the main file
// when publishing a story, with its index.html. With an index.html beside them, they're taken to
// be an old build, and aren't part of the story unless it @imports them.
const OLD_BUILD_FILES = ["story.js", "style.css", "squiffy.runtime.js", "squiffy.runtime.global.js"];

// The kinds of file that are part of a story
export const isSquiffyPath = (path: string) => path.endsWith(".squiffy");
export const isStylesheetPath = (path: string) => path.endsWith(".css");
export const isScriptPath = (path: string) => path.endsWith(".js");
export const isStoryFilePath = (path: string) => isSquiffyPath(path) || isStylesheetPath(path) || isScriptPath(path);

export interface StoryFiles {
    // The main file, as in the project file
    main: string;
    // The story's other .squiffy files, sorted by path
    included: string[];
    // The story's .css files, sorted by path
    stylesheets: string[];
    // The story's .js files, sorted by path
    scripts: string[];
    // .squiffy, .css and .js files that `exclude` leaves out, sorted by path. Files in
    // always-skipped folders, the build folder and an old build aren't listed.
    excluded: string[];
}

// Sorts paths by code point, so the order is the same everywhere, whatever the locale.
export const comparePaths = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

// Which of a project's files make up the story: its .squiffy files, stylesheets and scripts.
// `paths` are relative to the project file's folder, with "/" separators, as from a recursive
// listing of the folder; files of other kinds are ignored. Pass `skip` to leave out more files
// or folders, such as a build's output folder.
export function getStoryFiles(project: ProjectFile, paths: Iterable<string>, skip: string[] = []): StoryFiles {
    const included: string[] = [];
    const stylesheets: string[] = [];
    const scripts: string[] = [];
    const excluded: string[] = [];
    const all = new Set(paths);
    const skipped = [BUILD_FOLDER, ...skip].map(folder => normalisePath(folder)).filter(folder => folder !== null);
    const mainSlash = project.main.lastIndexOf("/");
    const mainFolder = mainSlash < 0 ? "" : project.main.substring(0, mainSlash + 1);
    const oldBuild = all.has(mainFolder + "index.html") ? new Set(OLD_BUILD_FILES.map(file => mainFolder + file)) : new Set();
    for (const path of all) {
        if (!isStoryFilePath(path) || path == project.main || isAlwaysSkipped(path) || oldBuild.has(path)) continue;
        if (skipped.some(folder => path == folder || path.startsWith(folder + "/"))) continue;
        if (isExcluded(path, project.exclude)) excluded.push(path);
        else if (isSquiffyPath(path)) included.push(path);
        else if (isStylesheetPath(path)) stylesheets.push(path);
        else scripts.push(path);
    }
    return {
        main: project.main,
        included: included.sort(comparePaths),
        stylesheets: stylesheets.sort(comparePaths),
        scripts: scripts.sort(comparePaths),
        excluded: excluded.sort(comparePaths),
    };
}

// The story's files after the main file, in the order the compiler takes them (see
// AnalyseSettings.storyFiles): its .squiffy files, then its stylesheets, then its scripts.
export const storyFileList = (story: StoryFiles) => [...story.included, ...story.stylesheets, ...story.scripts];

// The text of a new project file. It's given a new random id, unless one is passed in.
export function formatProjectFile(project: { main: string; exclude?: string[]; map?: MapPositions; id?: string; panels?: Panel[] }): string {
    const json: Record<string, unknown> = {
        $schema: PROJECT_SCHEMA_URL,
        version: PROJECT_FILE_VERSION,
        id: project.id ?? crypto.randomUUID(),
        main: project.main,
    };
    if (project.exclude?.length) json.exclude = project.exclude;
    if (project.panels?.length) json.panels = project.panels;
    const text = JSON.stringify(json, null, 2) + "\n";
    return project.map ? updateProjectFile(text, { map: project.map })! : text;
}

// Changes a project file's text, keeping any other properties it has. Returns undefined if the
// text isn't a JSON object. A `map` with no positions removes it.
export function updateProjectFile(text: string, changes: { main?: string; exclude?: string[]; map?: MapPositions }): string | undefined {
    let json: unknown;
    try {
        json = JSON.parse(text);
    }
    catch {
        return undefined;
    }
    if (!json || typeof json != "object" || Array.isArray(json)) return undefined;
    const data = { ...(json as Record<string, unknown>) };
    if (changes.main !== undefined) data.main = changes.main;
    if (changes.exclude !== undefined) {
        if (changes.exclude.length) data.exclude = changes.exclude;
        else delete data.exclude;
    }
    if (changes.map !== undefined) {
        const { sections, passages } = changes.map;
        const used = Object.fromEntries(Object.entries(passages).filter(([, byName]) => Object.keys(byName).length));
        // Anything else that's in "map" stays, but empty lists of positions don't
        const map: Record<string, unknown> = { ...(isObject(data.map) ? data.map : {}) };
        delete map.sections;
        delete map.passages;
        if (Object.keys(sections).length) map.sections = sections;
        if (Object.keys(used).length) map.passages = used;
        if (Object.keys(map).length) data.map = map;
        else delete data.map;
    }
    const indent = /^\{\s*\n([ \t]+)/.exec(text)?.[1] ?? 2;
    // Each position on one line, rather than an x and a y on lines of their own
    return JSON.stringify(data, null, indent).replace(/\[\s+(-?[\d.e+-]+),\s+(-?[\d.e+-]+)\s+\]/g, "[$1, $2]") + "\n";
}
