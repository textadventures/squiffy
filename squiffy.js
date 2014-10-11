#!/usr/bin/env node

var _ = require("underscore");
var path = require("path");

var squiffy_version = "2.0";

console.log("Squiffy " + squiffy_version);

function Compiler() {
	this.process = function(inputFilename, sourcePath, options) {
		var outputPath = path.resolve(path.dirname(inputFilename));

		var story = new Story();
		story.set_id(path.resolve(inputFilename));

		var success = this.processFile(story, path.resolve(inputFilename), true);

	    if (!success) {
	        console.log("Failed.");
	        return;
		}
	}

	this.processFile = function(story, inputFilename, isFirst) {
		if (_.contains(story.files, inputFilename)) {
			return true;
		}

		story.files.push(inputFilename)
    	console.log("Loading " + inputFilename);

    	return true;
	}
}

function Story() {
    this.sections = {};
    this.title = "";
    this.scripts = [];
    this.files = [];
    this.start = "";

    this.addSection = function(name, filename, line) {
        section = new Section(name, filename, line);
        this.sections[name] = section;
        return section;
    }

    this.set_id = function(filename) {
    	// TODO
        //file_id = str(uuid.getnode()) + filename
        //self.id = hashlib.sha1(file_id.encode('utf-8')).hexdigest()[0:10]
    }
}

function Section(name, filename, line) {
    this.name = name;
    this.filename = filename;
    this.line = line;
    this.text = [];
    this.passages = {};
    this.js = [];
    this.clear = false;
    this.attributes = [];

    this.addPassage = function(name, line) {
        passage = new Passage(name, line);
        this.passages[name] = passage;
        return passage;
    }

    this.addText = function(text) {
        this.text.push(text);
    }

    this.addJS = function(text) {
        this.js.push(text);
    }

    this.addAttribute = function(text) {
        this.attributes.push(text);
    }
}

function Passage(name, line) {
	this.name = name;
	this.line = line;
	this.text = [];
	this.js = [];
	this.clear = false;
	this.attributes = [];

    this.addText = function(text) {
        this.text.push(text);
    }

    this.addJS = function(text) {
        this.js.push(text);
    }

    this.addAttribute = function(text) {
        this.attributes.push(text);
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
	var compiler = new Compiler();
	compiler.process(process.argv[2], __dirname, options);
}