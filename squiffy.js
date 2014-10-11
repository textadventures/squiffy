#!/usr/bin/env node

var _ = require("underscore");
var path = require("path");
var fs = require("fs");
var glob = require("glob");

if (!String.prototype.format) {
  String.prototype.format = function() {
    var args = arguments;
    return this.replace(/{(\d+)}/g, function(match, number) { 
      return typeof args[number] != 'undefined'
        ? args[number]
        : match
      ;
    });
  };
}

String.prototype.endsWith = function(suffix) {
    return this.indexOf(suffix, this.length - suffix.length) !== -1;
};

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

	this.regex = {
		section: /^\[\[(.*)\]\]:$/,
	    passage: /^\[(.*)\]:$/,
	    title: /^@title (.*)$/,
	    import: /^@import (.*)$/,
	    start: /^@start (.*)$/,
	    attributes: /^@set (.*)$/,
	    unset: /^@unset (.*)$/,
	    inc: /^@inc (.*)$/,
	    dec: /^@dec (.*)$/,
	    replace: /^@replace (.*$)/,
	    js: /^(\t| {4})(.*)$/,
	    continue: /^\+\+\+(.*)$/,
	};

	this.processFile = function(story, inputFilename, isFirst) {
		if (_.contains(story.files, inputFilename)) {
			return true;
		}

		story.files.push(inputFilename)
    	console.log("Loading " + inputFilename);

    	var inputFile = fs.readFileSync(inputFilename);
		var inputLines = inputFile.toString().split("\n");

		var lineCount = 0;
		var autoSectionCount = 0;
		var section = null;
		var passage = null;
		var textStarted = false;
		var ensureSectionExists = function() {
			section = this.ensureSectionExists(story, section, isFirst, inputFilename, lineCount);
		};

		return inputLines.every(function(line) {
			var stripLine = line.trim();
        	lineCount++;

        	var match = _.object(_.map(this.regex, function (regex, key) {
			    return [key, regex.exec(stripLine)];
			}));

        	if (match.section) {
        		section = story.addSection(match.section[1], inputFilename, lineCount);
            	passage = null;
            	textStarted = false;
        	}
            else if (match.passage) {
            	if (!section) {
	                console.log("ERROR: {0} line {1}: Can't add passage '{2}' as no section has been created.".format(
	                    inputFilename, lineCount, match.passage[1]));
	                return false;
	            }
	            passage = section.addPassage(match.passage[1], lineCount);
	            textStarted = false;
            }
            else if (match.continue) {
            	ensureSectionExists();
	            autoSectionCount++;
	            var autoSectionName = "_continue{0}".format(autoSectionCount);
	            section.addText("[[{0}]]({1})".format(match.continue[1], autoSectionName));
	            section = story.addSection(autoSectionName, inputFilename, lineCount);
	            passage = null;
	            textStarted = false;
            }
            else if (stripLine == "@clear") {
                if (!passage) {
                    ensureSectionExists();
                    section.clear = true;
                }
                else {
                    passage.clear = true;
                }
            }
            else if (match.title) {
                story.title = match.title[1];
            }
            else if (match.start) {
                story.start = match.start[1];
            }
            else if (match.import) {
                var basePath = path.resolve(path.dirname(inputFilename));
                var newFilenames = path.join(basePath, match.import[1]);
                var importFilenames = glob.sync(newFilenames);
                importFilenames.every(function(importFilename) {
                    if (importFilename.endsWith(".squiffy")) {
                    	var success = this.processFile(story, importFilename, false);
                    	if (!success) return false;
                    }
                    else if (importFilename.endsWith(".js")) {
                    	story.scripts.push(path.relative(basePath, importFilename));
                    }

                    return true;
                }, this);
            }

            return true;
		}, this);
	};

	this.ensureSectionExists = function(story, section, isFirst, inputFilename, lineCount) {
	    if (!section && isFirst) {
	        section = story.addSection("_default", inputFilename, lineCount);
	    }
	    return section;
	};
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
	console.log("SECTION " + name);
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
	console.log("PASSAGE " + name);
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