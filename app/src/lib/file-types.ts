// What kind of file a project path is, by its extension.
import { extname, guessMimeType } from "@textadventures/project-fs";

const TEXT_EXTENSIONS = new Set([".squiffy", ".css", ".js", ".mjs", ".json", ".md", ".txt", ".html", ".htm", ".xml"]);

export const isSquiffyFile = (path: string) => extname(path).toLowerCase() === ".squiffy";

// Opens in the editor
export const isTextFile = (path: string) => TEXT_EXTENSIONS.has(extname(path).toLowerCase());

// Something a story shows or plays: these go to the preview, and appear in the Assets dialog
export function isAsset(path: string): boolean {
    const type = guessMimeType(path);
    return /^(image|audio|video|font)\//.test(type);
}

export const isImage = (path: string) => guessMimeType(path).startsWith("image/");
