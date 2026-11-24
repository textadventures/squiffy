// Importing a Quest 5 or Quest Viva gamebook: Open file converts a .aslx file, or a .quest file (a zip with the
// game and the images and sounds it uses), or any zip with a .aslx file in it, e.g. a game downloaded from
// Quest Viva, into a new Squiffy story, asking first.

import { unzipSync } from "fflate";
import { convertQuestGamebook, formatQuestProblems, QuestParseError, unzipSizeLimit, ZipTooBigError } from "squiffy-compiler";
import { confirmDialog } from "./confirm.js";

export const QUEST_FILE_PATTERN = /\.(aslx|quest)$/i;
export const QUEST_ACCEPT = ".quest,.aslx";
// Lists what couldn't be converted exactly, in the new story's folder
export const QUEST_PROBLEMS_FILE = "quest-import.txt";

export interface ConvertedQuest {
    // The story's files, by path
    files: Map<string, Uint8Array | string>;
    mainFile: string;
    title: string;
    // The number of things that couldn't be converted exactly
    problems: number;
}

// A path in a .quest file that's safe to write in a story folder
function safePath(name: string): boolean {
    const parts = name.replace(/\\/g, "/").split("/");
    return !name.startsWith("/") && !parts.some(p => p == ".." || p == "") && !parts[0].includes(":");
}

// A .quest file, or a zip with the game in it
function isArchive(fileName: string): boolean {
    return /\.(quest|zip)$/i.test(fileName);
}

// The game's source, and the files that came with it: those in the game's folder, by their
// path from there
function readGame(fileName: string, data: Uint8Array): { source: string, files: Map<string, Uint8Array> } {
    if (!isArchive(fileName)) {
        return { source: new TextDecoder().decode(data), files: new Map() };
    }
    let entries: Record<string, Uint8Array>;
    try {
        entries = unzipSync(data, { filter: unzipSizeLimit() });
    }
    catch (e) {
        if (e instanceof ZipTooBigError) throw new Error(`${fileName} is too big to convert. ${e.message}`, { cause: e });
        throw new Error(`${fileName} isn't a Quest game: it isn't a zip file.`, { cause: e });
    }
    // Folders, and the resource forks a Mac adds to a zip it makes
    const names = Object.keys(entries).filter(n => !n.endsWith("/") && !n.startsWith("__MACOSX/"));
    const main = findQuestGame(names);
    if (!main) throw new Error(`${fileName} isn't a Quest game: there's no game.aslx in it.`);
    const folder = main.slice(0, main.lastIndexOf("/") + 1);
    const files = new Map<string, Uint8Array>();
    for (const name of names) {
        const path = name.slice(folder.length);
        if (name.startsWith(folder) && !name.toLowerCase().endsWith(".aslx") && safePath(path)) files.set(path, entries[name]);
    }
    return { source: new TextDecoder().decode(entries[main]), files };
}

// The game in a zip's files: the top-most game.aslx, else the top-most .aslx file
export function findQuestGame(paths: Iterable<string>): string | undefined {
    const games = [...paths]
        .filter(p => p.toLowerCase().endsWith(".aslx"))
        .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
    return games.find(p => /(^|\/)game\.aslx$/i.test(p)) ?? games[0];
}

// Converts a Quest gamebook, once the author says to. Null if they cancel. Throws if the file
// isn't a Quest gamebook.
export async function convertQuestFile(fileName: string, data: Uint8Array): Promise<ConvertedQuest | null> {
    const game = readGame(fileName, data);
    const fromQuestFile = isArchive(fileName);
    let result;
    try {
        // Only a .quest file or zip says which files came with the game
        result = convertQuestGamebook(game.source, fromQuestFile ? { files: [...game.files.keys()] } : {});
    }
    catch (e) {
        if (e instanceof QuestParseError) throw new Error(`${fileName} can't be converted. ${e.message}`, { cause: e });
        throw e;
    }
    const name = result.title ? `"${result.title}"` : fileName;
    const pages = `${result.pages} page${result.pages == 1 ? "" : "s"}`;
    if (!(await confirmDialog(`${name} is a ${result.format} (${pages}). Convert it to Squiffy?`, { confirmLabel: "Convert" }))) {
        return null;
    }
    const files = new Map<string, Uint8Array | string>();
    for (const [path, bytes] of game.files) files.set(path, bytes);
    for (const [path, text] of Object.entries(result.files)) files.set(path, text);
    let problems = formatQuestProblems(result, fileName);
    if (!fromQuestFile && result.assets.length) {
        // The browser can only read the file it was given, not the folder it's in
        problems += `\nThe story uses ${result.assets.length} file${result.assets.length == 1 ? "" : "s"} from the game's folder, which ${result.assets.length == 1 ? "has" : "have"}n't been copied. Add ${result.assets.length == 1 ? "it" : "them"} to the story:\n${result.assets.map(a => `  ${a}`).join("\n")}\n`;
    }
    files.set(QUEST_PROBLEMS_FILE, problems);
    const missingAssets = !fromQuestFile ? result.assets.length : 0;
    return { files, mainFile: result.main, title: result.title, problems: result.problems.length + missingAssets };
}

// What to tell the author once it's converted
export function questImportMessage(converted: ConvertedQuest): string {
    return converted.problems == 0
        ? "Converted from Quest."
        : `Converted from Quest. ${converted.problems} thing${converted.problems == 1 ? "" : "s"} couldn't be converted exactly: they're listed in ${QUEST_PROBLEMS_FILE}.`;
}
