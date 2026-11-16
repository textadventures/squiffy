import * as fs from "fs";
import * as path from "path";
import type { CompileSuccess } from "squiffy-compiler";

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

        const filename = path.resolve(basePath, reference);
        const relative = path.relative(basePath, filename);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;

        let stat: fs.Stats;
        try {
            stat = fs.statSync(filename);
        } catch {
            continue;
        }
        if (!stat.isFile()) continue;

        result[relative.split(path.sep).join("/")] = fs.readFileSync(filename);
    }

    return result;
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
