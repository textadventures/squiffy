import { glob } from "glob";
import path from "path";
import fs from "fs/promises";

// glob doesn't return matches in a guaranteed order, but the order decides which
// same-named section wins and how continue sections are numbered. So sort them,
// like the editor does, by their path relative to the story's folder.
export const sortByRelativePath = (basePath: string, filenames: string[]): string[] => {
    const relative = (filename: string) => path.relative(basePath, filename).split(path.sep).join("/");
    return filenames
        .map(filename => ({ filename, key: relative(filename) }))
        .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
        .map(f => f.filename);
};

export const externalFiles = (inputFilename: string) => {
    const includedFiles = [path.resolve(inputFilename)];
    const basePath = path.resolve(path.dirname(inputFilename));
    return {
        getMatchingFilenames: async (pattern: string): Promise<string[]> => {
            const filenames = path.join(basePath, pattern);
            const result = await glob(filenames);
            return sortByRelativePath(basePath, result.filter((filename: string) => !includedFiles.includes(filename)));
        },
        getContent: async (filename: string): Promise<string> => {
            // Resolve relative paths against the base path
            const resolvedPath = path.isAbsolute(filename) ? filename : path.join(basePath, filename);
            includedFiles.push(resolvedPath);
            return (await fs.readFile(resolvedPath)).toString();
        },
        getLocalFilename(filename: string): string {
            return path.relative(basePath, filename);
        }
    };
};