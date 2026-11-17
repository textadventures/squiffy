/// <reference types="node" />

// Finding a story on disk, for the CLI and the Vite plugin. This is the only part of the compiler
// that touches the file system, and it's a separate entry point (squiffy-compiler/node), so the
// rest of the compiler stays free of Node dependencies.

import fs from "fs/promises";
import path from "path";
import { getStoryFiles, isAlwaysSkipped, parseProjectFile, PROJECT_FILENAME } from "./project.js";

export interface StoryOnDisk {
    // The story's main file, as an absolute path
    mainFile: string;
    // In folder mode, the story's other .squiffy files, as absolute paths, in order. Undefined
    // for a story that's just the main file and its @imports.
    storyFiles?: string[];
    // The squiffy.json that was used, as an absolute path
    projectFile?: string;
    // Something to tell the author, e.g. that a squiffy.json was ignored
    note?: string;
}

// A problem finding the story, with a message to show the author as is
export class StoryNotFoundError extends Error {}

export interface FindStoryOptions {
    // Folders to leave out of the story, relative to the project file's folder
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
export async function listSquiffyFiles(folder: string): Promise<string[]> {
    const result: string[] = [];
    const walk = async (relative: string) => {
        const entries = await fs.readdir(path.join(folder, relative), { withFileTypes: true });
        for (const entry of entries) {
            const child = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (!isAlwaysSkipped(`${child}/x`)) await walk(child);
            }
            else if (entry.name.endsWith(".squiffy")) {
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
    const story = getStoryFiles(project, await listSquiffyFiles(root), options.skip);
    return { mainFile, storyFiles: story.included.map(file => path.resolve(root, file)), projectFile };
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
    if (!projectFile) return { mainFile: resolved };
    const project = await readProject(projectFile);
    if (path.resolve(path.dirname(projectFile), project.main) == resolved) {
        return folderStory(projectFile, options);
    }
    return {
        mainFile: resolved,
        note: `Building just ${path.basename(resolved)}, as it isn't the main file in ${projectFile} (${project.main}).`,
    };
}
