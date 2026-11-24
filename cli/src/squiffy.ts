#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { serve } from "./server.js";
import { createPackageFiles, createTestingFiles, writeScriptFile } from "./file-packager.js";
import { convertV5File } from "./convert-v5.js";
import { convertV6Story } from "./convert-v6.js";
import { convertTwineFile } from "./convert-twine.js";
import { convertQuestFile } from "./convert-quest.js";
import { checkStory, formatCheckResult } from "./check.js";
import {
    formatChoicesFile, formatPlayResult, formatRandomResult, loadPlayableStory, MAX_INLINE_CHOICES, parseChoicesFile, playRandom,
    playStory, problemComments, type PlayResult, type RandomProblem, type SectionLabels,
} from "./play.js";
import {
    findTestFiles, formatTest, formatTestResults, parseTest, runTest, testFromResult, TestFileError, TEST_EXTENSION,
    type TestFileResult,
} from "./playtest.js";
import { parseInput, playInteractive } from "./interactive.js";
import readline from "readline";
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
    .describe("host", "Address for HTTP server to listen on (only with --serve). The default, 127.0.0.1, is this computer only; 0.0.0.0 lets other devices on the network play the story")
    .string("host")
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
    .describe("interactive", "With --play, keep playing, reading a link to click from each line of standard input, until it ends")
    .boolean("interactive")
    .describe("attributes", "With --play, show the story's attributes at the end")
    .boolean("attributes")
    .describe("record", "With --play, record the playthrough as a test, to a .squiffy-test file, for --test")
    .string("record")
    .describe("ignore", "With --record, attributes for the test not to record or compare, where * matches any characters. Repeat it for several")
    .array("ignore")
    .string("ignore")
    .describe("test", "Play the story the way each .squiffy-test file in its folder says (or the file or folder given), and report where it does something different")
    .describe("update", "With --test, record the tests that fail again, as the story plays now")
    .boolean("update")
    .describe("random", "Play the story this many times (default 20), clicking links at random, and report errors, dead ends, endings and what was never visited")
    .describe("steps", "With --random, the most links to click each time (default 200)")
    .number("steps")
    .describe("seed", "With --play, --record or --random, a number that makes the story's randomness the same every time")
    .number("seed")
    .describe("json", "With --check, --play, --random or --test, print the result as JSON")
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

// Reports what stopped a command, as JSON with --json: { "success": false, "errors": [...] }, the
// same for every command. (--check's own result has errorCount, as its errors are in "problems".)
function failWith(errors: string[]): false {
    if (argv.json) console.log(JSON.stringify({ success: false, errors }, null, 2));
    else errors.forEach(error => console.error(error));
    return false;
}
const fail = (message: string) => failWith([message]);

const findStoryOrExit = async () => {
    try {
        return await findStory(input);
    }
    catch (e) {
        if (!(e instanceof StoryNotFoundError)) throw e;
        fail(e.message);
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
else if (argv.test !== undefined) {
    process.exitCode = await test() ? 0 : 1;
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
    const packageOptions = {
        inlineHtml: !!options.inline,
        backButton: story.backButton,
        saveButton: story.saveButton,
        startAnywhere: story.startAnywhere,
        strings: story.strings,
    };
    const result = await createPackageFiles(story, outputPath, { ...packageOptions, createZip: !!options.zip });

    if (result && options.serve) {
        const port = (argv.p as number) || 8282;
        // The page that's served can start at any section, and has the story's @test sections.
        // The files just written don't, as they're the story as it'll be published.
        serve(outputPath, port, await createTestingFiles(story, packageOptions), (argv.host as string | undefined) || undefined);
    }
}

async function play(): Promise<boolean> {
    const story = await findStoryOrExit();
    const loaded = await loadPlayableStory(story);
    if (!loaded.success) return failWith(loaded.errors);
    if (argv.seed !== undefined && !Number.isInteger(argv.seed)) {
        return fail("--seed should be a whole number.");
    }

    if (argv.random !== undefined) {
        const runs = argv.random === true || argv.random === "" ? 20 : Number(argv.random);
        const steps = argv.steps ?? 200;
        if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(steps) || steps < 1) {
            return fail("--random and --steps should be whole numbers, 1 or more.");
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
        const parsed = parseInput(input);
        if (!parsed) {
            return fail(`--input should be attribute=value, not "${input}".`);
        }
        inputs[parsed.attribute] = parsed.value;
    }

    const choose: string[] = [];
    if (argv.choices !== undefined) {
        try {
            choose.push(...parseChoicesFile(fs.readFileSync(argv.choices, "utf8")));
        }
        catch {
            return fail(`Couldn't read ${argv.choices}.`);
        }
    }
    choose.push(...argv.choose ?? []);

    // With --start, it starts a new game, but the saved game's persistent attributes (#539) carry on
    let save;
    if (argv.save && fs.existsSync(argv.save)) {
        try {
            save = JSON.parse(fs.readFileSync(argv.save, "utf8"));
        }
        catch {
            return fail(`${argv.save} isn't a saved game.`);
        }
    }

    const record = argv.record;
    if (record !== undefined) {
        if (!record) {
            return fail(`Give the file to record the test to, e.g. --record tests/playthrough${TEST_EXTENSION}`);
        }
        if (argv.save) {
            return fail("--record can't carry on from a saved game, as a test plays from the start.");
        }
    }
    const ignore = (argv.ignore ?? []).flatMap(names => names.split(/[\s,]+/)).filter(name => name);
    if (ignore.length && !record) {
        return fail("--ignore goes with --play --record. To ignore attributes in a test, add an ignore line to the test file.");
    }
    // A test needs a seed, so the story's randomness is the same each time it's played
    const seed = argv.seed ?? (record ? Math.floor(Math.random() * 1000000) : undefined);

    const writeTest = (result: PlayResult, testInputs: Record<string, string>) => {
        const test = testFromResult(result, { seed: seed!, start: argv.start, inputs: testInputs, ignore });
        fs.mkdirSync(path.dirname(path.resolve(record!)), { recursive: true });
        fs.writeFileSync(record!, formatTest(test));
    };

    if (argv.interactive) {
        // Output goes straight to stdout, as console.log is the story's while it's being played
        const write = (text: string) => process.stdout.write(text);
        const reader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
        // Lines are only kept from when the iterator is made, and they may come in while the
        // story's being set up
        const iterator = reader[Symbol.asyncIterator]();
        const lines = { [Symbol.asyncIterator]: () => iterator };
        const result = await playInteractive(loaded.playable, {
            start: argv.start, choose, inputs, save, seed, stepAttributes: !!record, json: argv.json, showAttributes: !!argv.attributes,
        }, lines, write, line => {
            if (argv.save) fs.writeFileSync(argv.save, JSON.stringify(line.save));
        });
        reader.close();
        if (record) {
            // Links that weren't there aren't in the steps, so the test can still be played
            if (result.hasErrors) {
                const message = "The test wasn't recorded, as the story had errors.";
                write(argv.json ? JSON.stringify({ notRecorded: message }) + "\n" : message + "\n");
            }
            else {
                writeTest({ steps: result.steps } as PlayResult, result.inputs);
                write(argv.json ? JSON.stringify({ recorded: record, seed }) + "\n" : `Recorded the test to ${record} (--seed ${seed}).\n`);
            }
        }
        return result.success;
    }

    const result = await playStory(loaded.playable, {
        start: argv.start, choose, inputs, save, seed, stepAttributes: !!record,
    });
    if (argv.save) fs.writeFileSync(argv.save, JSON.stringify(result.save));
    let recorded: string | undefined;
    let notRecorded: string | undefined;
    if (record) {
        if (result.success) {
            writeTest(result, inputs);
            recorded = record;
        }
        else {
            notRecorded = result.stopped
                ? "The test wasn't recorded, as play stopped early."
                : "The test wasn't recorded, as the story had errors.";
        }
    }
    if (argv.json) {
        // The saved game is for --save, and is mostly the HTML on the screen
        const steps = result.steps.map(step => ({ ...step, attributes: undefined }));
        console.log(JSON.stringify({ ...result, steps, save: undefined, recorded, notRecorded }, null, 2));
    }
    else {
        console.log(formatPlayResult(result, !!argv.attributes));
        if (recorded) console.log(`\nRecorded the test to ${recorded} (--seed ${seed}).`);
        if (notRecorded) console.log(`\n${notRecorded}`);
    }
    return result.success;
}

// --test: plays the story the way each test file says, and reports where it did something
// different. With --update, a test that fails is recorded again, as the story plays now.
async function test(): Promise<boolean> {
    const story = await findStoryOrExit();
    const root = path.dirname(story.projectFile ?? story.mainFile);
    if (argv.ignore?.length) return fail("--ignore goes with --play --record. To ignore attributes in a test, add an ignore line to the test file.");
    const target = typeof argv.test == "string" && argv.test ? argv.test : root;
    if (!fs.existsSync(target)) return fail(`There's no file or folder called ${target}.`);
    const files = findTestFiles(target, root);
    if (!files.length) {
        return fail(`There are no ${TEST_EXTENSION} files in ${path.relative(process.cwd(), target) || "this folder"}. Record one with --play --record.`);
    }

    const loaded = await loadPlayableStory(story);
    if (!loaded.success) return failWith(loaded.errors);

    const results: TestFileResult[] = [];
    for (const file of files) {
        const name = path.relative(process.cwd(), file).split(path.sep).join("/");
        let expected;
        try {
            expected = parseTest(fs.readFileSync(file, "utf8"));
        }
        catch (e) {
            if (!(e instanceof TestFileError)) throw e;
            results.push({ file: name, passed: false, differences: [e.message] });
            continue;
        }
        const { actual, ...outcome } = await runTest(loaded.playable, expected);
        const result: TestFileResult = { file: name, ...outcome };
        if (!outcome.passed && argv.update) {
            if (actual) {
                fs.writeFileSync(file, formatTest(actual));
                result.updated = true;
            }
            else {
                result.notUpdated = "play didn't get to the end without errors, so the story or the test needs fixing first.";
            }
        }
        results.push(result);
    }

    const success = results.every(r => r.passed || r.updated);
    const notes = loaded.playable.scripts.length
        ? [`The story's script files (${loaded.playable.scripts.join(", ")}) aren't run when testing from the command line.`]
        : [];
    if (argv.json) console.log(JSON.stringify({ success, tests: results, notes }, null, 2));
    else console.log(formatTestResults(results, notes));
    return success;
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
