/// <reference types="node" />

// Finding a story on disk, for the CLI and the Vite plugin. This is the only part of the compiler
// that touches the file system, and it's a separate entry point (squiffy-compiler/node), so the
// rest of the compiler stays free of Node dependencies.

import fs from "fs/promises";
import path from "path";
import {
    getStoryFiles, isAlwaysSkipped, isSquiffyPath, isStoryFilePath, parseProjectFile, PROJECT_FILENAME, storyFileList,
    type PageStrings, type Panel, type PlayerSetting,
} from "./project.js";

export interface StoryOnDisk {
    // The story's main file, as an absolute path
    mainFile: string;
    // In folder mode, the story's other files, as absolute paths, in order: its .squiffy files,
    // then its .css and .js files (see AnalyseSettings.storyFiles). Undefined for a story that's
    // just the main file and its @imports.
    storyFiles?: string[];
    // The squiffy.json that was used, as an absolute path
    projectFile?: string;
    // Something to tell the author, e.g. that a squiffy.json was ignored
    note?: string;
    // Whether @set and link setters take expressions (#373): true if there's a squiffy.json in
    // the story's folder or above, even if it's only building one file
    expressions: boolean;
    // squiffy.json's "backButton", in folder mode
    backButton?: boolean;
    // squiffy.json's "strings", in folder mode
    strings?: PageStrings;
    // squiffy.json's "saveButton", in folder mode
    saveButton?: boolean;
    // squiffy.json's "startAnywhere", in folder mode
    startAnywhere?: boolean;
    // squiffy.json's "id", in folder mode
    projectId?: string;
    // squiffy.json's "panels", in folder mode
    panels?: Panel[];
    // squiffy.json's "settings", in folder mode
    settings?: PlayerSetting[];
    // squiffy.json's "persistent", in folder mode
    persistent?: string[];
    // squiffy.json's "description", "author" and "cover", in folder mode
    description?: string;
    author?: string;
    cover?: string;
}

// A problem finding the story, with a message to show the author as is
export class StoryNotFoundError extends Error {}

export interface FindStoryOptions {
    // Files and folders to leave out of the story, relative to the project file's folder or
    // absolute. Its build folder is always left out.
    skip?: string[];
}

const exists = async (filename: string) => {
    try {
        await fs.access(filename);
        return true;
    }
    catch {
        return false;
    }
};

const isDirectory = async (filename: string) => {
    try {
        return (await fs.stat(filename)).isDirectory();
    }
    catch {
        return false;
    }
};

// The nearest squiffy.json in a folder or the folders above it
async function findProjectFile(folder: string): Promise<string | undefined> {
    for (let dir = path.resolve(folder); ; dir = path.dirname(dir)) {
        const candidate = path.join(dir, PROJECT_FILENAME);
        if (await exists(candidate)) return candidate;
        if (path.dirname(dir) == dir) return undefined;
    }
}

// Every .squiffy file in a folder and its subfolders, relative to it with "/" separators, without
// looking inside the folders that are never part of a story.
export const listSquiffyFiles = (folder: string) => listFiles(folder, isSquiffyPath);

// Every .squiffy, .css and .js file in a folder and its subfolders, as listSquiffyFiles, and any
// index.html, which getStoryFiles needs to see to leave out an old build
export const listStoryFiles = (folder: string) => listFiles(folder, name => isStoryFilePath(name) || name == "index.html");

async function listFiles(folder: string, include: (name: string) => boolean): Promise<string[]> {
    const result: string[] = [];
    const walk = async (relative: string) => {
        const entries = await fs.readdir(path.join(folder, relative), { withFileTypes: true });
        for (const entry of entries) {
            const child = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (!isAlwaysSkipped(`${child}/x`)) await walk(child);
            }
            else if (include(entry.name)) {
                result.push(child);
            }
        }
    };
    await walk("");
    return result;
}

async function readProject(projectFile: string) {
    const parsed = parseProjectFile(await fs.readFile(projectFile, "utf8"));
    if (!parsed.success) {
        throw new StoryNotFoundError(`${parsed.error} (${projectFile})`);
    }
    return parsed.project;
}

async function folderStory(projectFile: string, options: FindStoryOptions): Promise<StoryOnDisk> {
    const root = path.dirname(projectFile);
    const project = await readProject(projectFile);
    const mainFile = path.resolve(root, project.main);
    if (!await exists(mainFile)) {
        throw new StoryNotFoundError(`The main file in ${projectFile}, ${project.main}, doesn't exist.`);
    }
    // Absolute paths to skip are made relative to the project, and any outside it are ignored
    const skip = (options.skip ?? []).map(file => path.isAbsolute(file) ? path.relative(root, file).split(path.sep).join("/") : file)
        .filter(file => file && !file.startsWith("..") && !path.isAbsolute(file));
    const story = getStoryFiles(project, await listStoryFiles(root), skip);
    return {
        mainFile, storyFiles: storyFileList(story).map(file => path.resolve(root, file)), projectFile, expressions: true,
        ...(project.backButton !== undefined ? { backButton: project.backButton } : {}),
        ...(project.strings !== undefined ? { strings: project.strings } : {}),
        ...(project.saveButton !== undefined ? { saveButton: project.saveButton } : {}),
        ...(project.startAnywhere !== undefined ? { startAnywhere: project.startAnywhere } : {}),
        ...(project.id !== undefined ? { projectId: project.id } : {}),
        ...(project.panels !== undefined ? { panels: project.panels } : {}),
        ...(project.settings !== undefined ? { settings: project.settings } : {}),
        ...(project.persistent !== undefined ? { persistent: project.persistent } : {}),
        ...(project.description !== undefined ? { description: project.description } : {}),
        ...(project.author !== undefined ? { author: project.author } : {}),
        ...(project.cover !== undefined ? { cover: project.cover } : {}),
    };
}

// Finds the story to build from what the author gave: a folder with a squiffy.json in it, or a
// .squiffy file.
//
// - A folder builds the project in its squiffy.json.
// - A project's main file (with a squiffy.json in its folder or above) builds the project.
// - Any other .squiffy file builds just that file and its @imports, as it would with no
//   squiffy.json, with a note saying so. So several stories can share a folder.
export async function findStory(input: string, options: FindStoryOptions = {}): Promise<StoryOnDisk> {
    const resolved = path.resolve(input);
    if (await isDirectory(resolved)) {
        const projectFile = path.join(resolved, PROJECT_FILENAME);
        if (!await exists(projectFile)) {
            throw new StoryNotFoundError(`There's no ${PROJECT_FILENAME} in ${resolved}. Give the story's .squiffy file instead, or add a ${PROJECT_FILENAME} to make the folder one story.`);
        }
        return folderStory(projectFile, options);
    }
    if (!await exists(resolved)) {
        throw new StoryNotFoundError(`${input} doesn't exist.`);
    }

    const projectFile = await findProjectFile(path.dirname(resolved));
    if (!projectFile) return { mainFile: resolved, expressions: false };
    const project = await readProject(projectFile);
    if (path.resolve(path.dirname(projectFile), project.main) == resolved) {
        return folderStory(projectFile, options);
    }
    return {
        mainFile: resolved,
        note: `Building just ${path.basename(resolved)}, as it isn't the main file in ${projectFile} (${project.main}).`,
        expressions: true,
    };
}
