#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { serve } from "./server.js";
import { createPackageFiles, writeScriptFile } from "./file-packager.js";
import { convertV5File } from "./convert-v5.js";
import { convertV6Story } from "./convert-v6.js";
import { convertTwineFile } from "./convert-twine.js";
import { convertQuestFile } from "./convert-quest.js";
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
    .describe("convert-quest", "Convert a Quest gamebook (a .quest or .aslx file) to Squiffy, in a new folder next to it")
    .boolean("convert-quest")
    .describe("out", "With --convert-twine or --convert-quest, the folder to put the Squiffy story in")
    .string("out")
    .version(version)
    .parseSync();

console.log("Squiffy " + version);

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
        console.error(e.message);
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
        console.error("Give the Quest gamebook to convert: a .quest or .aslx file.");
        process.exitCode = 1;
    }
    else if (!convertQuestFile(input, argv.out)) {
        process.exitCode = 1;
    }
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