#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { createPackage } from './packager.js';
import { serve } from './server.js';
import { SQUIFFY_VERSION } from 'squiffy-compiler';

const argv = yargs(hideBin(process.argv))
    .usage(
        `Usage: $0 filename.squiffy [options]`)
    .demand(1)
    .alias('s', 'serve')
    .alias('p', 'port')
    .describe('s', 'Start HTTP server after compiling')
    .describe('p', 'Port for HTTP server (only with --serve)')
    .describe('scriptonly', 'Only generate JavaScript file (and optionally specify a name)')
    .describe('zip', 'Create zip file')
    .parseSync();

console.log('Squiffy ' + SQUIFFY_VERSION);

var options = {
    serve: argv.s,
    scriptOnly: argv.scriptonly,
    pluginName: argv.pluginname,
    zip: argv.zip,
    write: true,
};

const inputFilename = argv._[0] as string;

var result = await createPackage(inputFilename);

if (result && options.serve) {
    var port = (argv.p as number) || 8282;
    serve(result, port);
}