// The squiffy.json project file, which makes a folder of .squiffy files one story:
//
//   { "version": 1, "main": "story.squiffy", "exclude": ["drafts/**"] }
//
// Without it, a story is its main file plus whatever that @imports. With it, the story is every
// .squiffy file in the folder and its subfolders, except those `exclude` matches: the main file
// first, then the rest in path order. These are the rules the CLI, the Vite plugin, the language
// service and the editor all share. They're pure functions, so each can supply its own file list.

export const PROJECT_FILENAME = "squiffy.json";

// The newest project file format this version of Squiffy understands. It counts the file
// format, not the Squiffy release, and only goes up when the meaning of a project changes.
export const PROJECT_FILE_VERSION = 1;

// Where the project file's JSON schema is published
export const PROJECT_SCHEMA_URL = "https://squiffystory.com/schema/squiffy.json";

export interface ProjectFile {
    version: number;
    // The story's main file, relative to the project file's folder, with "/" separators.
    main: string;
    // Glob patterns for .squiffy files that aren't part of the story, relative to the project
    // file's folder. "*" and "?" match within a folder name, "**" across folders, and a pattern
    // that matches a folder excludes everything in it.
    exclude: string[];
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

    return { success: true, project: { version, main: mainPath, exclude: exclude as string[] } };
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

// Folders whose .squiffy files are never part of a story, whatever `exclude` says:
// node_modules, and folders whose names start with "." (.git, .vscode and the like).
export function isAlwaysSkipped(path: string): boolean {
    const folders = path.split("/").slice(0, -1);
    return folders.some(folder => folder == "node_modules" || folder.startsWith("."));
}

export interface StoryFiles {
    // The main file, as in the project file
    main: string;
    // The story's other .squiffy files, sorted by path
    included: string[];
    // .squiffy files that `exclude` leaves out, sorted by path. Files in always-skipped folders
    // aren't listed.
    excluded: string[];
}

// Sorts paths by code point, so the order is the same everywhere, whatever the locale.
export const comparePaths = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

// Which of a project's files make up the story. `paths` are relative to the project file's folder,
// with "/" separators, as from a recursive listing of the folder; anything that isn't a .squiffy
// file is ignored. Pass `skip` to leave out more folders, such as a build's output folder.
export function getStoryFiles(project: ProjectFile, paths: Iterable<string>, skip: string[] = []): StoryFiles {
    const included: string[] = [];
    const excluded: string[] = [];
    const skipped = skip.map(folder => normalisePath(folder)).filter(folder => folder !== null);
    for (const path of new Set(paths)) {
        if (!path.endsWith(".squiffy") || path == project.main || isAlwaysSkipped(path)) continue;
        if (skipped.some(folder => path.startsWith(folder + "/"))) continue;
        (isExcluded(path, project.exclude) ? excluded : included).push(path);
    }
    return { main: project.main, included: included.sort(comparePaths), excluded: excluded.sort(comparePaths) };
}

// The text of a new project file
export function formatProjectFile(project: { main: string; exclude?: string[] }): string {
    const json: Record<string, unknown> = {
        $schema: PROJECT_SCHEMA_URL,
        version: PROJECT_FILE_VERSION,
        main: project.main,
    };
    if (project.exclude?.length) json.exclude = project.exclude;
    return JSON.stringify(json, null, 2) + "\n";
}

// Changes a project file's text, keeping any other properties it has. Returns undefined if the
// text isn't a JSON object.
export function updateProjectFile(text: string, changes: { main?: string; exclude?: string[] }): string | undefined {
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
    const indent = /^\{\s*\n([ \t]+)/.exec(text)?.[1] ?? 2;
    return JSON.stringify(data, null, indent) + "\n";
}
