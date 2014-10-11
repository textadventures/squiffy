#!/usr/bin/env node

var _ = require("underscore");
var path = require("path");
var fs = require("fs");
var glob = require("glob");
var markdown = require("markdown").markdown;

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

		console.log ("Writing story.js")

	    var jsTemplateFile = fs.readFileSync(path.join(sourcePath, "squiffy.template.js"));
	    var jsData = "// Created with Squiffy {0}\n// https://github.com/textadventures/squiffy\n\n".format(squiffy_version) + jsTemplateFile.toString();

	    var outputJsFile = [];
	    outputJsFile.push(jsData);
	    outputJsFile.push("\n\n");
	    if (!story.start) {
	        story.start = Object.keys(story.sections)[0];
	    }
	    outputJsFile.push("squiffy.story.start = \"" + story.start + "\";\n");
	    outputJsFile.push("squiffy.story.id = \"{0}\";\n".format(story.id));
	    outputJsFile.push("squiffy.story.sections = {\n");

	    _.each(story.sections, function(section, sectionName) {
	        outputJsFile.push("\t\"{0}\": {{\n".format(sectionName));
	        if (section.clear) {
	            outputJsFile.push("\t\t\"clear\": true,\n");
	        }
	        outputJsFile.push("\t\t\"text\": {0},\n".format(JSON.stringify(this.processText(section.text.join("\n"), story, section, null))));
	        if (section.attributes.length > 0) {
	            outputJsFile.push("\t\t\"attributes\": {0},\n".format(JSON.stringify(section.attributes)));
	        }
	        if (section.js.length > 0) {
	            this.writeJs(outputJsFile, 2, section.js);
	        }

	        /*outputJsFile.push("\t\t\"passages\": {\n")
	        for passage_name in section.passages:
	            passage = section.passages[passage_name]

	            outputJsFile.push("\t\t\t\"{0}\": {{\n".format(passage_name))
	            if passage.clear:
	                outputJsFile.push("\t\t\t\t\"clear\": true,\n")
	            outputJsFile.push("\t\t\t\t\"text\": {0},\n".format(json.dumps(process_text("\n".join(passage.text), story, section, passage))))
	            if len(passage.attributes) > 0:
	                outputJsFile.push("\t\t\t\t\"attributes\": {0},\n".format(json.dumps(passage.attributes)))
	            if len(passage.js) > 0:
	                write_js(output_js_file, 4, passage.js)
	            outputJsFile.push("\t\t\t},\n")

	        outputJsFile.push("\t\t},\n")
	        outputJsFile.push("\t},\n")
	        */
	    }, this);
	    
	    fs.writeFileSync(path.join(outputPath, "story.js"), outputJsFile.join(""));
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

		var compiler = this;
		var lineCount = 0;
		var autoSectionCount = 0;
		var section = null;
		var passage = null;
		var textStarted = false;
		var ensureSectionExists = function() {
			section = compiler.ensureSectionExists(story, section, isFirst, inputFilename, lineCount);
		};

		return inputLines.every(function(line) {
			var stripLine = line.trim();
        	lineCount++;

        	var match = _.object(_.map(this.regex, function (regex, key) {
			    return [key, key == "js" ? regex.exec(line) : regex.exec(stripLine)];
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
			else if (match.attributes) {
                section = this.addAttribute(match.attributes[1], story, section, passage, isFirst, inputFilename, lineCount);
            }
            else if (match.unset) {
                section = this.addAttribute("not " + match.unset[1], story, section, passage, isFirst, inputFilename, lineCount);
            }
            else if (match.inc) {
                section = this.addAttribute(match.inc[1] + "+=1", story, section, passage, isFirst, inputFilename, lineCount);
            }
            else if (match.dec) {
                section = this.addAttribute(match.dec[1] + "-=1", story, section, passage, isFirst, inputFilename, lineCount);
            }
            else if (match.replace) {
                var replaceAttribute = match.replace[1];
                var attributeMatch = /^(.*?)=(.*)$/.exec(replaceAttribute);
                if (attributeMatch) {
                    replaceAttribute = attributeMatch[1] + "=" + this.processText(attributeMatch[2]);
                }
                section = this.addAttribute("@replace " + replaceAttribute, story, section, passage, isFirst, inputFilename, lineCount);
            }
            else if (!textStarted && match.js) {
	            if (!passage) {
	                ensureSectionExists();
	                section.addJS(match.js[2]);
	            }
	            else {
	                passage.addJS(match.js[2]);
	            }
	        }
	        else if (textStarted || stripLine.length > 0) {
	            if (!passage) {
	                ensureSectionExists();
	                if (section) {
	                    section.addText(line);
	                    textStarted = true;
	                }
	            }
	            else {
	                passage.addText(line);
	                textStarted = true;
	            }
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

	this.addAttribute = function (attribute, story, section, passage, isFirst, inputFilename, lineCount) {
	    if (!passage) {
	        section = this.ensureSectionExists(story, section, isFirst, inputFilename, lineCount);
	        section.addAttribute(attribute);
	    }
	    else {
	        passage.addAttribute(attribute);
	    }
	    return section;
	};

	this.processText = function(input, story, section, passage) {
	    // namedSectionLinkRegex matches:
	    //   open [[
	    //   any text - the link text
	    //   closing ]]
	    //   open bracket
	    //   any text - the name of the section
	    //   closing bracket
	    namedSectionLinkRegex = /\[\[(.*?)\]\]\((.*?)\)/;

	    //links = map(lambda m: m.group(2), namedSectionLinkRegex.finditer(input))
	    //check_section_links(story, links, section, passage)

	    input = input.replace(namedSectionLinkRegex, "<a class='squiffy-link' data-section='$2'>$1</a>");

	    // namedPassageLinkRegex matches:
	    //   open [
	    //   any text - the link text
	    //   closing ]
	    //   open bracket, but not http(s):// after it
	    //   any text - the name of the passage
	    //   closing bracket
	    namedPassageLinkRegex = /\[(.*?)\]\(((?!https?:\/\/).*?)\)/;

	    //links = map(lambda m: m.group(2), namedPassageLinkRegex.finditer(input))
	    //check_passage_links(story, links, section, passage)

	    input = input.replace(namedPassageLinkRegex, "<a class='squiffy-link' data-passage='$2'>$1</a>");

	    // unnamedSectionLinkRegex matches:
	    //   open [[
	    //   any text - the link text
	    //   closing ]]
	    unnamedSectionLinkRegex = /\[\[(.*?)\]\]/;

	    //links = map(lambda m: m.group(1), unnamedSectionLinkRegex.finditer(input))
	    //check_section_links(story, links, section, passage)

	    input = input.replace(unnamedSectionLinkRegex, "<a class='squiffy-link' data-section='$1'>$1</a>");

	    // unnamedPassageLinkRegex matches:
	    //   open [
	    //   any text - the link text
	    //   closing ]
	    //   no bracket after
	    unnamedPassageLinkRegex = /\[(.*?)\]([^\(]|$)/;

	    //links = map(lambda m: m.group(1), unnamedPassageLinkRegex.finditer(input))
	    //check_passage_links(story, links, section, passage)

	    input = input.replace(unnamedPassageLinkRegex, "<a class='squiffy-link' data-passage='$1'>$1</a>$2");

	    return markdown.toHTML(input);
	};

	this.writeJs = function(outputJsFile, tabCount, js) {
	    var tabs = new Array(tabCount + 1).join("\t");
	    outputJsFile.push("{0}\"js\": function() {{\n".format(tabs));
	    js.forEach(function(jsLine) {
	    	outputJsFile.push("{0}\t{1}\n".format(tabs, jsLine));
	    });
	    outputJsFile.push("{0}}},\n".format(tabs));
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