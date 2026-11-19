import * as fs from "fs";
import path from "path";
import { unzipSync } from "fflate";
import { convertQuestGamebook, formatQuestProblems, QuestParseError } from "squiffy-compiler";

export const PROBLEMS_FILENAME = "quest-import.txt";

// A path in a .quest file, or one the game names, that's safe to write inside the new folder
function safePath(name: string): string | undefined {
    const normalised = name.replace(/\\/g, "/");
    if (normalised.startsWith("/") || /^[a-z]:/i.test(normalised)) return undefined;
    const parts = normalised.split("/");
    if (parts.some(p => p == ".." || p == "")) return undefined;
    return parts.join(path.sep);
}

interface Game {
    source: string;
    // The other files that came with the game, by their path relative to it
    files: Map<string, () => Uint8Array>;
}

// A .quest file is a zip, with the game in game.aslx and the files it uses beside it. A .aslx file
// is the game on its own, with the files it uses in its folder.
function readGame(inputFilename: string): Game | undefined {
    if (inputFilename.toLowerCase().endsWith(".quest")) {
        let entries: Record<string, Uint8Array>;
        try {
            entries = unzipSync(fs.readFileSync(inputFilename));
        }
        catch {
            console.error(`${inputFilename} isn't a Quest game: it isn't a zip file.`);
            return undefined;
        }
        const names = Object.keys(entries).filter(n => !n.endsWith("/"));
        const main = names.find(n => n.toLowerCase() == "game.aslx") ?? names.find(n => n.toLowerCase().endsWith(".aslx"));
        if (!main) {
            console.error(`${inputFilename} isn't a Quest game: there's no game.aslx in it.`);
            return undefined;
        }
        const files = new Map<string, () => Uint8Array>();
        for (const name of names) {
            if (name != main && !name.toLowerCase().endsWith(".aslx")) files.set(name, () => entries[name]);
        }
        return { source: new TextDecoder().decode(entries[main]), files };
    }
    const folder = path.dirname(inputFilename);
    const source = fs.readFileSync(inputFilename, "utf8");
    // Only the files the game uses are copied, as a .aslx file's folder can have anything in it
    const files = new Map<string, () => Uint8Array>();
    let assets: string[];
    try {
        assets = convertQuestGamebook(source).assets;
    }
    catch (e) {
        if (e instanceof QuestParseError) return { source, files };
        throw e;
    }
    for (const asset of assets) {
        const relative = safePath(asset);
        if (!relative) continue;
        const file = path.join(folder, relative);
        if (fs.existsSync(file) && fs.statSync(file).isFile()) files.set(asset, () => fs.readFileSync(file));
    }
    return { source, files };
}

// Converts a Quest 5 or Quest Viva gamebook (a .aslx file, or a .quest file) into a new folder with a Squiffy
// story in it: the story file, a squiffy.json, a stylesheet if the game has its own colours or
// fonts, the images and sounds it uses, and quest-import.txt, which lists what couldn't be
// converted exactly. The folder is next to the Quest file, with the same name, unless another is
// given. Returns false if the game couldn't be converted.
export const convertQuestFile = (inputFilename: string, outputFolder?: string): boolean => {
    console.log("Loading " + inputFilename);
    if (!fs.existsSync(inputFilename)) {
        console.error(`${inputFilename} doesn't exist.`);
        return false;
    }

    const parsed = path.parse(path.resolve(inputFilename));
    const folder = path.resolve(outputFolder ?? path.join(parsed.dir, parsed.name));
    if (fs.existsSync(folder) && (!fs.statSync(folder).isDirectory() || fs.readdirSync(folder).length > 0)) {
        console.error(`${folder} already exists. Choose another folder with --out, or move it out of the way.`);
        return false;
    }

    const game = readGame(inputFilename);
    if (!game) return false;
    let result;
    try {
        result = convertQuestGamebook(game.source, { files: [...game.files.keys()] });
    }
    catch (e) {
        if (e instanceof QuestParseError) {
            console.error(e.message);
            return false;
        }
        throw e;
    }

    fs.mkdirSync(folder, { recursive: true });
    for (const [name, read] of game.files) {
        const relative = safePath(name);
        if (!relative || Object.prototype.hasOwnProperty.call(result.files, relative)) continue;
        fs.mkdirSync(path.dirname(path.join(folder, relative)), { recursive: true });
        fs.writeFileSync(path.join(folder, relative), read());
    }
    for (const [name, text] of Object.entries(result.files)) {
        fs.writeFileSync(path.join(folder, name), text);
    }
    fs.writeFileSync(path.join(folder, PROBLEMS_FILENAME), formatQuestProblems(result, parsed.base));

    const relative = path.relative(process.cwd(), folder) || ".";
    console.log(`Converted ${result.pages} page${result.pages == 1 ? "" : "s"} from a ${result.format} into ${path.join(relative, result.main)}.`);
    if (result.problems.length > 0) {
        console.warn(`${result.problems.length} thing${result.problems.length == 1 ? "" : "s"} couldn't be converted exactly. They're listed in ${path.join(relative, PROBLEMS_FILENAME)}.`);
    }
    console.log(`To try it: npx @textadventures/squiffy-cli ${relative} -s`);
    return true;
};
