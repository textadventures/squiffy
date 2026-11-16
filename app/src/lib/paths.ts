// Paths as a story refers to files: relative to the main file's folder.
import { dirname } from "@textadventures/project-fs";

// `path` relative to the folder `fromDir`, e.g. an image's path as the main file refers to it
export function relativePath(fromDir: string, path: string): string {
    const from = fromDir === "" ? [] : fromDir.split("/");
    const to = path.split("/");
    let common = 0;
    while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
    return [...from.slice(common).map(() => ".."), ...to.slice(common)].join("/");
}

// A file's path as the story refers to it: relative to the main file's folder
export function storyPath(project: { mainFile: string }, path: string): string {
    return relativePath(dirname(project.mainFile), path);
}
