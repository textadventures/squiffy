#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { createPackage } from './packager.js';
import { serve } from './server.js';

import pkg from '../package.json' with { type: 'json' };
const version = pkg.version;

const argv = yargs(hideBin(process.argv))
    .usage(
        `Usage: squiffy-packager filename.squiffy [options]`)
    .demand(1)
    .alias('s', 'serve')
    .alias('p', 'port')
    .describe('s', 'Start HTTP server after compiling')
    .describe('p', 'Port for HTTP server (only with --serve)')
    .describe('scriptonly', 'Only generate JavaScript file (and optionally specify a name)')
    .describe('zip', 'Create zip file')
    .version(version)
    .parseSync();

console.log('Squiffy ' + version);

const options = {
    serve: argv.s,
    scriptOnly: argv.scriptonly,
    pluginName: argv.pluginname,
    zip: argv.zip,
    write: true,
};

const inputFilename = argv._[0] as string;

const result = await createPackage(inputFilename);

if (result && options.serve) {
    const port = (argv.p as number) || 8282;
    serve(result, port);
}