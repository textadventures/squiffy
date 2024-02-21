#!/usr/bin/env node
/* jshint quotmark: single */

'use strict';

var path = require('path');
var fs = require('fs');
var compiler = require('./compiler.js');

var packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json')).toString());
var squiffyVersion = packageJson.version;

function startServer(dir, port) {
    var finalhandler = require('finalhandler');
    var http = require('http');
    var serveStatic = require('serve-static');

    var serve = serveStatic(dir, { index: ['index.html'] });

    var server = http.createServer(function(req, res){
        var done = finalhandler(req, res);
        serve(req, res, done);
    });

    server.listen(port);
}

console.log('Squiffy ' + squiffyVersion);

var argv = require('yargs')
    .usage('Compiles a Squiffy script file into HTML and JavaScript.\nFor help, see http://docs.textadventures.co.uk/squiffy/\nUsage: $0 filename.squiffy [options]')
    .demand(1)
    .alias('c', 'cdn')
    .alias('s', 'serve')
    .alias('p', 'port')
    .describe('c', 'Use CDN for jQuery')
    .describe('s', 'Start HTTP server after compiling')
    .describe('p', 'Port for HTTP server (only with --serve)')
    .describe('scriptonly', 'Only generate JavaScript file (and optionally specify a name)')
    .describe('pluginname', 'Specify the jQuery plugin name instead of .questkit (only with --scriptonly)')
    .describe('zip', 'Create zip file')
    .argv;

var options = {
    useCdn: argv.c,
    serve: argv.s,
    scriptOnly: argv.scriptonly,
    pluginName: argv.pluginname,
    zip: argv.zip,
    write: true,
};

var result = compiler.generate(argv._[0], options);

if (result && options.serve) {
    var port = argv.p || 8282;
    startServer(result, port);
    console.log('Started http://localhost:' + port + '/');
}