// Getting stories out of the editor, and back in: publishing (with the packager, in the language
// worker), and the whole project as a zip, which Open file reads back as a new story. A zip is how
// to keep a copy of a story kept in the browser, which lives only there.
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { isJunkFile, isSkippedDirectory, parsePath } from "@textadventures/project-fs";
import { parseProjectFile, PROJECT_FILENAME, unzipSizeLimit, ZipTooBigError } from "squiffy-compiler";
import { isSquiffyFile, isTextFile } from "./file-types.js";
import { storyPath } from "./paths.js";
import type { OpenProject } from "./project.svelte.js";

// Offers a file to save, as a download
export function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A file name from a story's title, e.g. "The Cave" -> "The Cave.zip"
export function fileName(title: string, extension: string) {
    const name = [...title].filter(c => c >= " " && !'\\/:*?"<>|'.includes(c)).join("").trim() || "story";
    return `${name}${extension}`;
}

// Every file in the project, with the editor's unsaved text for open files
async function projectFiles(project: OpenProject): Promise<Map<string, Uint8Array>> {
    const files = new Map<string, Uint8Array>();
    for (const { path } of project.files) {
        const open = project.fileAt(path);
        files.set(path, open ? strToU8(open.text) : await project.fs.read(path));
    }
    return files;
}

// Every file in the project, with its text files as text: what a link to the story is made from
// (share-link.ts)
export async function projectContents(project: OpenProject): Promise<Map<string, string | Uint8Array>> {
    const files = new Map<string, string | Uint8Array>();
    for (const [path, data] of await projectFiles(project)) files.set(path, isTextFile(path) ? strFromU8(data) : data);
    return files;
}

// What the published story needs besides its own code: every file other than .squiffy ones (and
// squiffy.json) in the main file's folder, by its path from there, as the story refers to it
export async function storyAssets(project: OpenProject): Promise<Record<string, Uint8Array>> {
    const assets: Record<string, Uint8Array> = {};
    for (const [path, data] of await projectFiles(project)) {
        const relative = storyPath(project, path);
        if (!isSquiffyFile(path) && path !== PROJECT_FILENAME && !relative.startsWith("../")) assets[relative] = data;
    }
    return assets;
}

export async function zipProject(project: OpenProject): Promise<Uint8Array> {
    return zipSync(Object.fromEntries(await projectFiles(project)));
}

// The files in a project zip, by project path. A zip of a folder (one top-level folder holding
// everything) is unwrapped, and OS junk and anything that isn't a valid project path is skipped.
export function readProjectZip(data: Uint8Array): Map<string, Uint8Array> {
    let unzipped: Record<string, Uint8Array>;
    try {
        // Capped, as a zip from someone else can say it holds gigabytes (#644)
        unzipped = unzipSync(data, { filter: unzipSizeLimit() });
    } catch (e) {
        if (e instanceof ZipTooBigError) throw new Error(`This zip is too big to open. ${e.message}`, { cause: e });
        throw e;
    }
    // Folders, and the resource forks a Mac adds to a zip it makes
    const entries = Object.entries(unzipped)
        .filter(([path]) => !path.endsWith("/") && !path.startsWith("__MACOSX/"));
    const tops = new Set(entries.map(([path]) => path.split("/")[0]));
    const unwrap = tops.size === 1 && entries.every(([path]) => path.includes("/"));
    const files = new Map<string, Uint8Array>();
    for (const [entry, bytes] of entries) {
        const path = unwrap ? entry.slice(entry.indexOf("/") + 1) : entry;
        const segments = path.split("/");
        if (isJunkFile(segments[segments.length - 1]) || segments.slice(0, -1).some(isSkippedDirectory)) continue;
        try {
            parsePath(path);
        } catch {
            continue;
        }
        files.set(path, bytes);
    }
    return files;
}

// The main file of a project read from a zip: the one its squiffy.json names, if it has one and
// that file is in the zip, else a guess
export function zipMainFile(files: Map<string, Uint8Array>): string | undefined {
    const project = files.get(PROJECT_FILENAME);
    if (project) {
        const parsed = parseProjectFile(new TextDecoder().decode(project));
        if (parsed.success && files.has(parsed.project.main)) return parsed.project.main;
    }
    return guessMainFile(files.keys());
}

// The Twine story in a zip with no .squiffy file in it: its only .twee or .tw file, else its only
// HTML file, as in a published game (an HTML file that isn't a Twine story fails to convert)
export function zipTwineFile(files: Map<string, Uint8Array>): string | undefined {
    const paths = [...files.keys()];
    const twee = paths.filter(p => /\.(twee|tw)$/i.test(p));
    if (twee.length) return twee.length == 1 ? twee[0] : undefined;
    const html = paths.filter(p => /\.html?$/i.test(p));
    return html.length == 1 ? html[0] : undefined;
}

// The main file of a project read from a zip: the top-most .squiffy file, then the first by name
export function guessMainFile(paths: Iterable<string>): string | undefined {
    return [...paths]
        .filter(isSquiffyFile)
        .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0];
}
