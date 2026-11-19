import * as fs from "fs";
import * as path from "path";
import { findCssUrls, resolveCssUrl, type CompileSuccess } from "squiffy-compiler";

// File types that we look for references to in a story. Anything else (.squiffy, .js, .css, .html etc.)
// is either part of the story source or something we'd be guessing about.
const assetExtensions = [
    "apng", "avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp",
    "aac", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "weba",
    "m4v", "mp4", "ogv", "webm", "vtt",
    "otf", "ttf", "woff", "woff2",
    "pdf",
];

// Matches things that look like a relative path to an asset file, e.g. "cat.png", "images/cat.png",
// "./sounds/meow.mp3" or "my%20cat.png". Paths containing spaces aren't matched, so use %20 for those.
const assetPathPattern = new RegExp(
    String.raw`(?<![\w%./:\\-])((?:\.\/)?[\w%.-]+(?:\/[\w%.-]+)*\.(?:${assetExtensions.join("|")}))(?![\w%/-])`,
    "gi");

/**
 * Finds the asset files referenced by a story: anything in the story text or scripts that looks like a
 * relative path to an asset file (by extension), and exists in the story's folder (or below it).
 * Returns a map of path (relative to the story folder, with "/" separators) to bytes.
 */
export const findAssets = (inputFilename: string, storyText: string): Record<string, Uint8Array> => {
    const basePath = path.resolve(path.dirname(inputFilename));
    const result: Record<string, Uint8Array> = {};

    for (const match of storyText.matchAll(assetPathPattern)) {
        let reference = match[1].replace(/^(\.\/)+/, "");
        try {
            reference = decodeURI(reference);
        } catch {
            // Not valid percent-encoding - use it as it is
        }
        if (reference in result) continue;
        readFileInFolder(basePath, reference, result);
    }

    return result;
};

// Adds a file to result, by its path relative to basePath, if it's a file in that folder (or below it)
const readFileInFolder = (basePath: string, reference: string, result: Record<string, Uint8Array>) => {
    const filename = path.resolve(basePath, reference);
    const relative = path.relative(basePath, filename);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return;

    let stat: fs.Stats;
    try {
        stat = fs.statSync(filename);
    } catch {
        return;
    }
    if (!stat.isFile()) return;

    result[relative.split(path.sep).join("/")] = fs.readFileSync(filename);
};

/**
 * Reads the story's own stylesheets and scripts (@import of .css and .js files), which the compiler
 * names relative to the story folder, so they can go in the zip or be included in a single HTML file.
 */
export const findImportedFiles = (inputFilename: string, result: CompileSuccess): Record<string, Uint8Array> => {
    const basePath = path.resolve(path.dirname(inputFilename));
    const { externalStylesheets, externalScripts } = result.getUiInfo();
    const files: Record<string, Uint8Array> = {};
    for (const reference of [...externalStylesheets, ...externalScripts]) {
        readFileInFolder(basePath, reference, files);
    }
    return files;
};

/**
 * Finds the files the story's own stylesheets refer to with url(), such as a font's files, by their
 * path from the stylesheet's folder. `imported` is what findImportedFiles read.
 */
export const findStylesheetAssets = (inputFilename: string, result: CompileSuccess, imported: Record<string, Uint8Array>): Record<string, Uint8Array> => {
    const basePath = path.resolve(path.dirname(inputFilename));
    const files: Record<string, Uint8Array> = {};
    for (const sheet of result.getUiInfo().externalStylesheets) {
        const sheetPath = sheet.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
        const bytes = imported[sheetPath];
        if (!bytes) continue;
        for (const url of findCssUrls(new TextDecoder().decode(bytes))) {
            const reference = resolveCssUrl(sheetPath, url);
            if (reference !== null && !(reference in files)) readFileInFolder(basePath, reference, files);
        }
    }
    return files;
};

// All the text and script in a compiled story, which is where we look for asset references.
export const getStoryText = (result: CompileSuccess): string => {
    const texts: string[] = [];
    for (const section of Object.values(result.output.story.sections)) {
        texts.push(section.text ?? "");
        for (const passage of Object.values(section.passages ?? {})) {
            texts.push(passage.text ?? "");
        }
    }
    for (const js of result.output.js) {
        texts.push(...js);
    }
    return texts.join("\n");
};
