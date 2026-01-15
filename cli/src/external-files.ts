import { glob } from "glob";
import path from "path";
import fs from "fs/promises";

export const externalFiles = (inputFilename: string) => {
    const includedFiles = [path.resolve(inputFilename)];
    const basePath = path.resolve(path.dirname(inputFilename));
    return {
        getMatchingFilenames: async (pattern: string): Promise<string[]> => {
            const filenames = path.join(basePath, pattern);
            const result = await glob(filenames);
            return result.filter((filename: string) => !includedFiles.includes(filename));
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