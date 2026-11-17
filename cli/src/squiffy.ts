#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { serve } from "./server.js";
import { createPackageFiles, writeScriptFile } from "./file-packager.js";
import { convertV5File } from "./convert-v5.js";
import { findStory, StoryNotFoundError } from "squiffy-compiler/node";

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
else if (options.scriptOnly) {
    const story = await findStoryOrExit();
    const outputFilename = typeof options.scriptOnly === "string" ? options.scriptOnly : "story.js";
    await writeScriptFile(story, path.dirname(story.mainFile), outputFilename);
}
else {
    const story = await findStoryOrExit();
    const outputPath = path.dirname(story.mainFile);
    const result = await createPackageFiles(story, outputPath, {
        createZip: !!options.zip,
        inlineHtml: !!options.inline
    });

    if (result && options.serve) {
        const port = (argv.p as number) || 8282;
        serve(outputPath, port);
    }
}