'use strict';

import * as path from 'path';
import * as fs from 'fs';
import * as compiler from './compiler.js';
import finalhandler from 'finalhandler';
import * as http from 'http';
import serveStatic from 'serve-static';

function startServer(dir: string, port: number) {    
    var serve = serveStatic(dir, { index: ['index.html'] });

    var server = http.createServer(function (req: any, res: any) {
        var done = finalhandler(req, res);
        serve(req, res, done);
    });

    server.listen(port);
}

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

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

console.log('Squiffy ' + compiler.COMPILER_VERSION);

var options = {
    useCdn: argv.c,
    serve: argv.s,
    scriptOnly: argv.scriptonly,
    pluginName: argv.pluginname,
    zip: argv.zip,
    write: true,
};

const inputFilename = argv._[0] as string;

const template = fs.readFileSync(path.join(import.meta.dirname, "squiffy.template.js")).toString();

var result = await compiler.generate(inputFilename, template /*, options */);

if (result && options.serve) {
    var port = (argv.p as number) || 8282;
    startServer(result, port);
    console.log('Started http://localhost:' + port + '/');
}