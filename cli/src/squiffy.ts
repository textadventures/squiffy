#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { serve } from "./server.js";
import { createPackageFiles, writeScriptFile } from "./file-packager.js";
import { convertV5File } from "./convert-v5.js";
import { convertV6Story } from "./convert-v6.js";
import { convertTwineFile } from "./convert-twine.js";
import { convertQuestFile } from "./convert-quest.js";
import { checkStory, formatCheckResult } from "./check.js";
import {
    formatChoicesFile, formatPlayResult, formatRandomResult, loadPlayableStory, MAX_INLINE_CHOICES, parseChoicesFile, playRandom,
    playStory, problemComments, type RandomProblem, type SectionLabels,
} from "./play.js";
import fs from "fs";
import { findStory, StoryNotFoundError, type StoryOnDisk } from "squiffy-compiler/node";
import { BUILD_FOLDER } from "squiffy-compiler";

import pkg from "../package.json" with { type: "json" };
import path from "path";
const version = pkg.version;

const argv = yargs(hideBin(process.argv))
    .usage(
        "Usage: npx @textadventures/squiffy-cli [filename.squiffy | folder] [options]\n\n" +
        "With a folder (or nothing, for the current folder), builds the story in its squiffy.json.")
    .alias("s", "serve")
    .alias("p", "port")
    .describe("s", "Start HTTP server after compiling")
    .describe("p", "Port for HTTP server (only with --serve)")
    .describe("scriptonly", "Only generate JavaScript file (and optionally specify a name)")
    .describe("zip", "Create zip file")
    .describe("inline", "Create single HTML file with everything inlined")
    .describe("convert-v5", "Convert Squiffy 5 text processor syntax to Squiffy 6, keeping a backup of the original file")
    .boolean("convert-v5")
    .describe("convert-v6", "Convert a Squiffy 6 story's @set and link setters to Squiffy 7's rules and add a squiffy.json, keeping a backup of each file changed")
    .boolean("convert-v6")
    .describe("convert-twine", "Convert a Twine story (a .twee file, or Twine's published or archive .html) to Squiffy, in a new folder next to it")
    .boolean("convert-twine")
    .describe("convert-quest", "Convert a Quest 5 or Quest Viva gamebook (a .quest or .aslx file) to Squiffy, in a new folder next to it")
    .boolean("convert-quest")
    .describe("out", "With --convert-twine or --convert-quest, the folder to put the Squiffy story in")
    .string("out")
    .describe("check", "Check the story for problems, such as broken links, sections that can't be reached and dead ends, without building it")
    .boolean("check")
    .describe("play", "Play the story as text, printing what the player sees and the links they can click")
    .boolean("play")
    .describe("choose", "With --play, a link to click, by its text or its number. Repeat it to click several in order")
    .array("choose")
    .string("choose")
    .describe("choices", "With --play, a file with links to click in it, one on each line, clicked before any --choose")
    .string("choices")
    .describe("input", "With --play, text for a text box, as attribute=value. Repeat it for several")
    .array("input")
    .string("input")
    .describe("start", "With --play, the section to start at")
    .string("start")
    .describe("save", "With --play, a file to carry on from, if it exists, and to save the game to afterwards")
    .string("save")
    .describe("attributes", "With --play, show the story's attributes at the end")
    .boolean("attributes")
    .describe("random", "Play the story this many times (default 20), clicking links at random, and report errors, dead ends, endings and what was never visited")
    .describe("steps", "With --random, the most links to click each time (default 200)")
    .number("steps")
    .describe("seed", "With --play or --random, a number that makes the story's randomness the same every time")
    .number("seed")
    .describe("json", "With --check, --play or --random, print the result as JSON")
    .boolean("json")
    .version(version)
    .parseSync();

if (!argv.json) console.log("Squiffy " + version);

const options = {
    serve: argv.s,
    scriptOnly: argv.scriptonly,
    zip: argv.zip,
    inline: argv.inline
};

const input = argv._[0] === undefined ? "." : String(argv._[0]);

// Where the published files go. A project with a squiffy.json is built into its build folder, so
// they're kept apart from the story's own files, which they'd otherwise become part of. A story
// without one is built next to its main file, as in Squiffy 6.
const outputPathFor = (story: StoryOnDisk) =>
    story.projectFile ? path.join(path.dirname(story.projectFile), BUILD_FOLDER) : path.dirname(story.mainFile);

const findStoryOrExit = async () => {
    try {
        return await findStory(input);
    }
    catch (e) {
        if (!(e instanceof StoryNotFoundError)) throw e;
        if (argv.json) console.log(JSON.stringify({ success: false, errors: [e.message] }, null, 2));
        else console.error(e.message);
        process.exit(1);
    }
};

if (argv.convertV5) {
    if (argv._[0] === undefined) {
        console.error("Give the .squiffy file to convert.");
        process.exitCode = 1;
    }
    else if (!convertV5File(input)) {
        process.exitCode = 1;
    }
}
else if (argv.convertV6) {
    if (argv._[0] === undefined) {
        console.error("Give the story's main .squiffy file to convert.");
        process.exitCode = 1;
    }
    else if (!await convertV6Story(input)) {
        process.exitCode = 1;
    }
}
else if (argv.convertTwine) {
    if (argv._[0] === undefined) {
        console.error("Give the Twine file to convert: a .twee file, or Twine's published or archive .html.");
        process.exitCode = 1;
    }
    else if (!convertTwineFile(input, argv.out)) {
        process.exitCode = 1;
    }
}
else if (argv.convertQuest) {
    if (argv._[0] === undefined) {
        console.error("Give the Quest 5 or Quest Viva gamebook to convert: a .quest or .aslx file.");
        process.exitCode = 1;
    }
    else if (!convertQuestFile(input, argv.out)) {
        process.exitCode = 1;
    }
}
else if (argv.check) {
    const story = await findStoryOrExit();
    const result = await checkStory(story);
    console.log(argv.json ? JSON.stringify(result, null, 2) : formatCheckResult(result));
    if (!result.success) process.exitCode = 1;
}
else if (argv.play || argv.random !== undefined) {
    process.exitCode = await play() ? 0 : 1;
}
else if (options.scriptOnly) {
    const story = await findStoryOrExit();
    const outputFilename = typeof options.scriptOnly === "string" ? options.scriptOnly : "story.js";
    await writeScriptFile(story, outputPathFor(story), outputFilename);
}
else {
    const story = await findStoryOrExit();
    const outputPath = outputPathFor(story);
    const result = await createPackageFiles(story, outputPath, {
        createZip: !!options.zip,
        inlineHtml: !!options.inline,
        backButton: story.backButton,
        saveButton: story.saveButton,
        strings: story.strings,
    });

    if (result && options.serve) {
        const port = (argv.p as number) || 8282;
        serve(outputPath, port);
    }
}

async function play(): Promise<boolean> {
    const story = await findStoryOrExit();
    const loaded = await loadPlayableStory(story);
    if (!loaded.success) {
        if (argv.json) console.log(JSON.stringify({ success: false, errors: loaded.errors }, null, 2));
        else loaded.errors.forEach(error => console.error(error));
        return false;
    }
    if (argv.seed !== undefined && !Number.isInteger(argv.seed)) {
        console.error("--seed should be a whole number.");
        return false;
    }

    if (argv.random !== undefined) {
        const runs = argv.random === true || argv.random === "" ? 20 : Number(argv.random);
        const steps = argv.steps ?? 200;
        if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(steps) || steps < 1) {
            console.error("--random and --steps should be whole numbers, 1 or more.");
            return false;
        }
        const seed = argv.seed ?? Math.floor(Math.random() * 1000000);
        const result = await playRandom(loaded.playable, { runs, steps, seed, start: argv.start });
        const choicesFiles = writeChoicesFiles(story, result.problems, result.sectionLabels);
        if (argv.json) {
            const problems = result.problems.map((p, i) => choicesFiles[i] ? { ...p, choicesFile: choicesFiles[i] } : p);
            console.log(JSON.stringify({ ...result, problems }, null, 2));
        }
        else {
            console.log(formatRandomResult(result, argv.start, choicesFiles));
        }
        return result.success;
    }

    const inputs: Record<string, string> = {};
    for (const input of argv.input ?? []) {
        const equals = input.indexOf("=");
        if (equals < 1) {
            console.error(`--input should be attribute=value, not "${input}".`);
            return false;
        }
        inputs[input.substring(0, equals)] = input.substring(equals + 1);
    }

    const choose: string[] = [];
    if (argv.choices !== undefined) {
        try {
            choose.push(...parseChoicesFile(fs.readFileSync(argv.choices, "utf8")));
        }
        catch {
            console.error(`Couldn't read ${argv.choices}.`);
            return false;
        }
    }
    choose.push(...argv.choose ?? []);

    let save;
    if (argv.save && argv.start === undefined && fs.existsSync(argv.save)) {
        try {
            save = JSON.parse(fs.readFileSync(argv.save, "utf8"));
        }
        catch {
            console.error(`${argv.save} isn't a saved game.`);
            return false;
        }
    }

    const result = await playStory(loaded.playable, {
        start: argv.start, choose, inputs, save, seed: argv.seed,
    });
    if (argv.save) fs.writeFileSync(argv.save, JSON.stringify(result.save));
    if (argv.json) {
        // The saved game is for --save, and is mostly the HTML on the screen
        console.log(JSON.stringify({ ...result, save: undefined }, null, 2));
    }
    else {
        console.log(formatPlayResult(result, !!argv.attributes));
    }
    return result.success;
}

// The way to each problem --random found that takes too many links to give on the command line,
// as a file for --choices, in a "random" folder where the story is built. Files from the last
// time are removed.
function writeChoicesFiles(story: StoryOnDisk, problems: RandomProblem[], labels?: SectionLabels): (string | undefined)[] {
    const folder = path.join(outputPathFor(story), "random");
    if (fs.existsSync(folder)) {
        for (const file of fs.readdirSync(folder)) {
            if (/^problem-\d+\.txt$/.test(file)) fs.rmSync(path.join(folder, file));
        }
    }
    return problems.map((problem, i) => {
        if (problem.choices.length <= MAX_INLINE_CHOICES) return undefined;
        fs.mkdirSync(folder, { recursive: true });
        const file = path.join(folder, `problem-${i + 1}.txt`);
        fs.writeFileSync(file, formatChoicesFile(problem.choices, problemComments(problem, labels)));
        return path.relative(process.cwd(), file).split(path.sep).join("/");
    });
}
