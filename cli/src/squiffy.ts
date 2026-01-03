#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { serve } from "./server.js";
import { createPackageFiles, writeScriptFile } from "./file-packager.js";

import pkg from "../package.json" with { type: "json" };
import path from "path";
const version = pkg.version;

const argv = yargs(hideBin(process.argv))
    .usage(
        "Usage: npx @textadventures/squiffy-cli filename.squiffy [options]")
    .demand(1)
    .alias("s", "serve")
    .alias("p", "port")
    .describe("s", "Start HTTP server after compiling")
    .describe("p", "Port for HTTP server (only with --serve)")
    .describe("scriptonly", "Only generate JavaScript file (and optionally specify a name)")
    .describe("zip", "Create zip file")
    .version(version)
    .parseSync();

console.log("Squiffy " + version);

const options = {
    serve: argv.s,
    scriptOnly: argv.scriptonly,
    zip: argv.zip
};

const inputFilename = argv._[0] as string;
const outputPath = path.resolve(path.dirname(inputFilename));

if (options.scriptOnly) {
    const outputFilename = typeof options.scriptOnly === "string" ? options.scriptOnly : "story.js";
    await writeScriptFile(inputFilename, outputPath, outputFilename);
}
else {
    const result = await createPackageFiles(inputFilename, outputPath, !!options.zip);

    if (result && options.serve) {
        const port = (argv.p as number) || 8282;
        serve(outputPath, port);
    }
}