#!/usr/bin/env node

var _ = require("underscore");

var squiffy_version = "2.0";

console.log("Squiffy " + squiffy_version);

var compiler = {
	process: function(inputFilename, sourcePath, options) {
		console.log("inputFilename:" + inputFilename);
		console.log("sourcePath:" + sourcePath);
		console.log(options);
	}
}

function getOptions() {
	return {
		useCdn: _.contains(process.argv, "-c"),
	};
}

if (process.argv.length < 3) {
	console.log("Syntax: input.squiffy [-c]");
    console.log("Options:");
    console.log("   -c     Use CDN for jQuery");
}
else {
	var options = getOptions();
	compiler.process(process.argv[2], __dirname, options);
}