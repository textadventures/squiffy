// The compiler's ExternalFiles callbacks (@import and @ui) on top of the project file system,
// for multi-file projects (#118). Mirrors the CLI's cli/src/external-files.ts: patterns and
// @ui paths resolve against the main file's folder, and a file isn't imported twice.
import type { compile } from "squiffy-compiler";
import { dirname, resolvePath, type ProjectFileSystem } from "@textadventures/project-fs";

type ExternalFiles = NonNullable<Parameters<typeof compile>[0]["externalFiles"]>;

function escapeRegExp(s: string) {
    return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/** "*" and "?" match within one path segment; "**" matches across segments. */
export function globToRegExp(pattern: string): RegExp {
    let out = "";
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (c === "*") {
            if (pattern[i + 1] === "*") {
                i++;
                if (pattern[i + 1] === "/") {
                    i++;
                    out += "(?:.*/)?";
                } else {
                    out += ".*";
                }
            } else {
                out += "[^/]*";
            }
        } else if (c === "?") {
            out += "[^/]";
        } else {
            out += escapeRegExp(c);
        }
    }
    return new RegExp(`^${out}$`);
}

/** `path` relative to the project folder `fromDir`, e.g. for a <script src> next to the main file. */
export function relativePath(fromDir: string, path: string): string {
    const from = fromDir === "" ? [] : fromDir.split("/");
    const to = path.split("/");
    let common = 0;
    while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
    return [...from.slice(common).map(() => ".."), ...to.slice(common)].join("/");
}

export function projectExternalFiles(fs: ProjectFileSystem, mainFile: string): ExternalFiles {
    const baseDir = dirname(mainFile);
    const included = new Set([mainFile]);
    const matched = new Set<string>();

    return {
        async getMatchingFilenames(pattern: string): Promise<string[]> {
            const resolved = resolvePath(baseDir, pattern);
            if (resolved === null) return []; // climbs out of the project
            const re = globToRegExp(resolved);
            const files = (await fs.list()).map((f) => f.path).filter((p) => re.test(p) && !included.has(p));
            for (const f of files) matched.add(f);
            return files;
        },
        async getContent(filename: string): Promise<string> {
            // Paths from getMatchingFilenames are already project paths; anything else (an @ui
            // line) is relative to the main file's folder.
            const path = matched.has(filename) ? filename : resolvePath(baseDir, filename);
            if (path === null) throw new Error(`${filename} is outside the project`);
            included.add(path);
            return fs.readText(path);
        },
        getLocalFilename(filename: string): string {
            return relativePath(baseDir, filename);
        },
    };
}
