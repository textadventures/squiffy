// Squiffy: Convert Twine Story and Convert Quest Gamebook: the conversion itself, with no
// vscode import, so it can be tested. convert.ts asks for the files and writes the new story.
// Like the command-line tool (cli/src/convert-twine.ts and convert-quest.ts), the new story has
// a file listing what couldn't be converted exactly, and a Quest game's images and sounds.

import { unzipSync } from "fflate";
import {
    convertQuestGamebook, convertTwine, formatQuestProblems, formatTwineProblems, QuestParseError, TwineParseError,
} from "squiffy-compiler";

export const TWINE_EXTENSIONS = ["twee", "tw", "html", "htm"];
export const QUEST_EXTENSIONS = ["quest", "aslx"];
export const TWINE_PROBLEMS_FILE = "twine-import.txt";
export const QUEST_PROBLEMS_FILE = "quest-import.txt";

export interface ConvertedStory {
    // The new story's files, by their path from its folder, with "/" separators
    files: Map<string, Uint8Array | string>;
    // The main .squiffy file
    main: string;
    // e.g. 'Converted 12 passages from Harlowe 3.3.9.'
    summary: string;
    // The number of things that couldn't be converted exactly
    problems: number;
    // The file that lists them
    problemsFile: string;
}

const plural = (count: number, word: string) => `${count} ${word}${count == 1 ? "" : "s"}`;

/** The name for the new story's folder: the file's name without its extension, as the command-line tool names it */
export function storyFolderName(fileName: string): string {
    const base = fileName.replace(/^.*[\\/]/, "");
    return base.replace(/\.[^.]*$/, "") || base || "story";
}

/** A path from a game's folder, or in a .quest file, with "/" separators, if it's safe to write inside the new story's folder */
export function safePath(name: string): string | undefined {
    const normalised = name.replace(/\\/g, "/");
    if (normalised.startsWith("/") || /^[a-z]:/i.test(normalised)) return undefined;
    const parts = normalised.split("/");
    if (parts.some(p => p == ".." || p == "" || p == ".")) return undefined;
    return parts.join("/");
}

/** Converts a Twine story, in Twee or Twine's published or archive HTML. Throws if it isn't one. */
export function convertTwineFile(fileName: string, text: string): ConvertedStory {
    let result;
    try {
        result = convertTwine(text);
    }
    catch (e) {
        if (e instanceof TwineParseError) throw new Error(`${fileName} isn't a Twine story. ${e.message}`, { cause: e });
        throw e;
    }
    const files = new Map<string, Uint8Array | string>(Object.entries(result.files));
    files.set(TWINE_PROBLEMS_FILE, formatTwineProblems(result, fileName));
    return {
        files,
        main: result.main,
        summary: `Converted ${plural(result.passages, "passage")} from ${result.format || "Twine"}.`,
        problems: result.problems.length,
        problemsFile: TWINE_PROBLEMS_FILE,
    };
}

/** The game in a zip's files: the top-most game.aslx, else the top-most .aslx file */
export function findQuestGame(paths: Iterable<string>): string | undefined {
    const games = [...paths]
        .filter(p => p.toLowerCase().endsWith(".aslx"))
        .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
    return games.find(p => /(^|\/)game\.aslx$/i.test(p)) ?? games[0];
}

const isArchive = (fileName: string) => /\.(quest|zip)$/i.test(fileName);

// Reads a file from the game's folder, by its path from there, or undefined if it isn't there
export type ReadGameFile = (path: string) => Promise<Uint8Array | undefined>;

/**
 * Converts a Quest gamebook: a .quest file (a zip with the game and the files it uses), or a
 * .aslx file, whose images and sounds are read from its folder with readFile. Throws if it isn't
 * a gamebook.
 */
export async function convertQuestFile(fileName: string, data: Uint8Array, readFile: ReadGameFile): Promise<ConvertedStory> {
    let source: string;
    // The files that came with the game, by their path from it
    const gameFiles = new Map<string, Uint8Array>();
    if (isArchive(fileName)) {
        let entries: Record<string, Uint8Array>;
        try {
            entries = unzipSync(data);
        }
        catch (e) {
            throw new Error(`${fileName} isn't a Quest game: it isn't a zip file.`, { cause: e });
        }
        // Folders, and the resource forks a Mac adds to a zip it makes
        const names = Object.keys(entries).filter(n => !n.endsWith("/") && !n.startsWith("__MACOSX/"));
        const main = findQuestGame(names);
        if (!main) throw new Error(`${fileName} isn't a Quest game: there's no game.aslx in it.`);
        const folder = main.slice(0, main.lastIndexOf("/") + 1);
        for (const name of names) {
            const path = safePath(name.slice(folder.length));
            if (name.startsWith(folder) && !name.toLowerCase().endsWith(".aslx") && path) gameFiles.set(path, entries[name]);
        }
        source = new TextDecoder().decode(entries[main]);
    }
    else {
        source = new TextDecoder().decode(data);
    }

    const convert = (files?: string[]) => {
        try {
            return convertQuestGamebook(source, files ? { files } : {});
        }
        catch (e) {
            if (e instanceof QuestParseError) throw new Error(`${fileName} can't be converted. ${e.message}`, { cause: e });
            throw e;
        }
    };

    let result;
    if (isArchive(fileName)) {
        result = convert([...gameFiles.keys()]);
    }
    else {
        // Only the files the game uses are copied, as a .aslx file's folder can have anything in
        // it. It's converted again knowing which are there, so the missing ones are listed.
        for (const asset of convert().assets) {
            const path = safePath(asset);
            if (!path || gameFiles.has(path)) continue;
            const bytes = await readFile(path);
            if (bytes) gameFiles.set(path, bytes);
        }
        result = convert([...gameFiles.keys()]);
    }

    const files = new Map<string, Uint8Array | string>(gameFiles);
    for (const [path, text] of Object.entries(result.files)) files.set(path, text);
    files.set(QUEST_PROBLEMS_FILE, formatQuestProblems(result, fileName));
    return {
        files,
        main: result.main,
        summary: `Converted ${plural(result.pages, "page")} from a ${result.format}.`,
        problems: result.problems.length,
        problemsFile: QUEST_PROBLEMS_FILE,
    };
}

/** What to tell the author once it's converted */
export function convertedMessage(converted: ConvertedStory): string {
    if (converted.problems == 0) return converted.summary;
    return `${converted.summary} ${plural(converted.problems, "thing")} couldn't be converted exactly: they're listed in ${converted.problemsFile}.`;
}
