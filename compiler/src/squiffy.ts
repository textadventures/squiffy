import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { SQUIFFY_VERSION } from './version.js';
import { createPackage } from './packager.js';
import { serve } from './server.js';

const argv = yargs(hideBin(process.argv))
    .usage(
        `Usage: $0 filename.squiffy [options]`)
    .demand(1)
    .alias('c', 'cdn')
    .alias('s', 'serve')
    .alias('p', 'port')
    .describe('c', 'Use CDN for jQuery')
    .describe('s', 'Start HTTP server after compiling')
    .describe('p', 'Port for HTTP server (only with --serve)')
    .describe('scriptonly', 'Only generate JavaScript file (and optionally specify a name)')
    .describe('pluginname', 'Specify the jQuery plugin name instead of .squiffy (only with --scriptonly)')
    .describe('zip', 'Create zip file')
    .parseSync();

console.log('Squiffy ' + SQUIFFY_VERSION);

var options = {
    useCdn: argv.c,
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