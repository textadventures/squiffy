import { ProjectFsError } from "./errors.js";

// Paths in this layer are always relative to the project root, POSIX-style ("assets/cover.png"),
// and in Unicode NFC. parsePath() is the single gate every adapter (and the Electron main process,
// independently of the renderer) runs a path through. It rejects anything that could escape the
// root or that wouldn't survive a move between back ends: an absolute or drive path, "..",
// backslashes, NUL/control characters, characters Windows forbids (":" also blocks NTFS
// alternate data streams), Windows device names, and trailing dots or spaces (which Windows
// silently strips, so "a." and "a" would be the same file there).

const WINDOWS_FORBIDDEN = /[<>:"|?*\\]/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

function invalid(path: string, why: string): never {
    throw new ProjectFsError("INVALID_PATH", `Invalid path "${path}": ${why}`, path);
}

/** Checks one path segment (a file or directory name). Throws INVALID_PATH. */
export function checkSegment(segment: string, path = segment): void {
    if (segment === "") invalid(path, "empty segment");
    if (segment === "." || segment === "..") invalid(path, `"${segment}" segments aren't allowed`);
    if (segment.includes("/")) invalid(path, "a name can't contain \"/\"");
    if (CONTROL_CHARS.test(segment)) invalid(path, "control characters aren't allowed");
    if (WINDOWS_FORBIDDEN.test(segment)) invalid(path, "contains a character that isn't allowed in file names (< > : \" | ? * \\)");
    if (WINDOWS_DEVICE.test(segment)) invalid(path, `"${segment}" is a reserved device name on Windows`);
    if (/[. ]$/.test(segment)) invalid(path, "names can't end with a dot or a space");
}

/**
 * Splits a project path into segments, after normalising it to NFC and dropping a leading "./".
 * Throws INVALID_PATH. `allowRoot` accepts "" (or ".") as the root itself, for list().
 */
export function parsePath(path: string, allowRoot = false): string[] {
    if (typeof path !== "string") invalid(String(path), "not a string");
    let p = path.normalize("NFC");
    if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) invalid(path, "absolute paths aren't allowed");
    while (p.startsWith("./")) p = p.slice(2);
    if (p === "" || p === ".") {
        if (allowRoot) return [];
        invalid(path, "empty path");
    }
    if (p.endsWith("/")) p = p.slice(0, -1);
    const segments = p.split("/");
    for (const s of segments) checkSegment(s, path);
    return segments;
}

/** Normalises a project path to its canonical form ("./a//b" isn't accepted; "./a/b" becomes "a/b"). */
export function normalizePath(path: string): string {
    return parsePath(path).join("/");
}

export function joinPath(...parts: string[]): string {
    return parts.filter((p) => p !== "").join("/");
}

export function dirname(path: string): string {
    const i = path.lastIndexOf("/");
    return i < 0 ? "" : path.slice(0, i);
}

export function basename(path: string): string {
    return path.slice(path.lastIndexOf("/") + 1);
}

export function extname(path: string): string {
    const base = basename(path);
    const i = base.lastIndexOf(".");
    return i <= 0 ? "" : base.slice(i);
}

/**
 * Resolves `relative` (which may contain "." and ".." segments, e.g. from an @import line)
 * against the project directory `fromDir`. Returns null if it would climb above the root.
 */
export function resolvePath(fromDir: string, relative: string): string | null {
    const out = fromDir === "" ? [] : fromDir.split("/");
    for (const part of relative.normalize("NFC").split("/")) {
        if (part === "" || part === ".") continue;
        if (part === "..") {
            if (out.length === 0) return null;
            out.pop();
        } else {
            out.push(part);
        }
    }
    return out.join("/");
}

/** Case-folding key used to detect paths that differ only in case. */
export function caseKey(name: string): string {
    return name.normalize("NFC").toLowerCase();
}

/**
 * Files that operating systems scatter into real folders and that are never project content.
 * list() hides them.
 */
export function isJunkFile(name: string): boolean {
    return name === ".DS_Store" || name.startsWith("._") || name === "Thumbs.db" || name === "desktop.ini";
}

/**
 * Directories list() doesn't descend into: hidden ones (.git, .vscode, ...) and node_modules,
 * so opening a folder that happens to be a repo doesn't walk thousands of files. They can still
 * be read and written by explicit path.
 */
export function isSkippedDirectory(name: string): boolean {
    return name.startsWith(".") || name === "node_modules";
}
