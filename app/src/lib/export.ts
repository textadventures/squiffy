// Getting stories out of the editor, and back in: publishing (with the packager, in the language
// worker), and the whole project as a zip, which Open file reads back as a new draft. A zip is how
// to keep a copy of a draft, which lives only in this browser.
import { strToU8, unzipSync, zipSync } from "fflate";
import { isJunkFile, isSkippedDirectory, parsePath } from "@textadventures/project-fs";
import { parseProjectFile, PROJECT_FILENAME } from "squiffy-compiler";
import { isSquiffyFile } from "./file-types.js";
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
    // Folders, and the resource forks a Mac adds to a zip it makes
    const entries = Object.entries(unzipSync(data))
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

// The main file of a project read from a zip: the top-most .squiffy file, then the first by name
export function guessMainFile(paths: Iterable<string>): string | undefined {
    return [...paths]
        .filter(isSquiffyFile)
        .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0];
}
