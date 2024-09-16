import { SQUIFFY_VERSION } from './version.js';
import * as marked from 'marked';

export const getJs = async function (input: string, template: string) {
    const compiler = new Compiler();
    return await compiler.process(input, template);
};

export const generate = async function(inputFilename: string, /* sourcePath: string, */ template: string) {
    const compiler = new Compiler();
    return await compiler.generate(inputFilename, /* sourcePath, */ template);
}

export const getStoryData = async function(input: string) {
    const compiler = new Compiler();
    var story = new Story();
    await compiler.processFileText(story, input, "filename.squiffy", true);
    return await compiler.getStoryData(story);
}

interface Output {
    story: OutputStory;
    js: string[][];
}

interface OutputStory {
    start: string;
    id: string | null;
    sections: Record<string, OutputSection>;
}

interface OutputSection {
    text?: string;
    clear?: boolean;
    attributes?: string[];
    jsIndex?: number;
    passages?: Record<string, OutputPassage>;
    passageCount?: number;
}

interface OutputPassage {
    text?: string;
    clear?: boolean;
    attributes?: string[];
    jsIndex?: number;
}

import * as path from 'path';
import * as fs from 'fs';
// var glob = require('glob');
import * as crypto from 'crypto';

var squiffyVersion = SQUIFFY_VERSION;

class Compiler {
    async process(input: string, template: string) {
        var story = new Story();
        var success = await this.processFileText(story, input, /* null */ "filename.squiffy", true);
        if (!success) return 'Failed';
        return await this.getJs(story, template /*, {} */);
    };

    async generate(inputFilename: string, /* sourcePath: string, */ template: string /* , options */) {
        var outputPath;
        // if (options.write) {
            outputPath = path.resolve(path.dirname(inputFilename));
        // }

        var story = new Story();
        // if (inputFilename) {
            story.set_id(path.resolve(inputFilename));
        // }
        // else {
        //     story.set_id(options.input);
        // }

        var success;
        // if (inputFilename) {
            success = await this.processFile(story, path.resolve(inputFilename), true);
        // }
        // else {
        //     success = await this.processFileText(story, options.input, null, true);
        // }

        if (!success) {
            console.log('Failed.');
            return;
        }

        var storyJsName = /* typeof options.scriptOnly === 'string' ? options.scriptOnly : */ 'story.js';

        console.log('Writing ' + storyJsName);

        var storyJs = await this.getJs(story, template /*, sourcePath, options */);

        // if (options.write) {
            fs.writeFileSync(path.join(outputPath, storyJsName), storyJs);
        // }

        // if (!options.scriptOnly) {
            console.log('Writing index.html');

            var htmlTemplateFile = fs.readFileSync(this.findFile('index.template.html', outputPath /*, sourcePath */));
            var htmlData = htmlTemplateFile.toString();
            htmlData = htmlData.replace('<!-- INFO -->', `<!--\n\nCreated with Squiffy ${squiffyVersion}\n\n\nhttps://github.com/textadventures/squiffy\n\n-->`);
            htmlData = htmlData.replace('<!-- TITLE -->', story.title);
            // var jQueryPath = "";
            // if (typeof options.escritorio !== "undefined")
            //     jQueryPath = path.join(sourcePath, '..', 'jquery', 'dist', 'jquery.min.js');
            // else
            //     jQueryPath = path.join(sourcePath, 'node_modules', 'jquery', 'dist', 'jquery.min.js');
            var jqueryJs = 'jquery.min.js';
            // if (options.useCdn) {
            //     var jqueryVersion = packageJson.dependencies.jquery.match(/[0-9.]+/)[0];
            //     jqueryJs = `https://ajax.aspnetcdn.com/ajax/jquery/jquery-${jqueryVersion}.min.js`;
            // }
            // else if (options.write) {
                fs.createReadStream(path.join(import.meta.dirname, 'jquery.min.js')).pipe(fs.createWriteStream(path.join(outputPath, 'jquery.min.js')));
            // }

            htmlData = htmlData.replace('<!-- JQUERY -->', jqueryJs);

            var scriptData = story.scripts.map(script => `<script src="${script}"></script>`).join('\n');
            htmlData = htmlData.replace('<!-- SCRIPTS -->', scriptData);

            var stylesheetData = story.stylesheets.map(sheet => `<link rel="stylesheet" href="${sheet}"/>`).join('\n');
            htmlData = htmlData.replace('<!-- STYLESHEETS -->', stylesheetData);

            // if (options.write) {
                fs.writeFileSync(path.join(outputPath, 'index.html'), htmlData);
            // }

            console.log('Writing style.css');

            var cssTemplateFile = fs.readFileSync(this.findFile('style.template.css', outputPath /*, sourcePath */));
            var cssData = cssTemplateFile.toString();

            // if (options.write) {
                fs.writeFileSync(path.join(outputPath, 'style.css'), cssData);
            // }

            // if (options.zip) {
            //     console.log('Creating zip file');
            //     var JSZip = require('jszip');
            //     var zip = new JSZip();
            //     zip.file(storyJsName, storyJs);
            //     zip.file('index.html', htmlData);
            //     zip.file('style.css', cssData);
            //     if (!options.useCdn) {
            //         var jquery = fs.readFileSync(jQueryPath);
            //         zip.file(jqueryJs, jquery);
            //     }
            //     var buffer = zip.generate({
            //         type: 'nodebuffer'
            //     });
            //     if (options.write) {
            //         fs.writeFileSync(path.join(outputPath, 'output.zip'), buffer);
            //     }
            //     else {
            //         return buffer;
            //     }
            // }
        // }

        console.log('Done.');

        return outputPath;
    };

    async getJs(story: Story, template: string /*, options */) {
        // When calling from Vite, can set template this way:
        // const template = (await import('./squiffy.template.js?raw')).default;


        // if (options.scriptOnly && options.pluginName) {
        //     jsData = jsData.replace('jQuery.fn.squiffy =', 'jQuery.fn.' + options.pluginName + ' =');
        // }

        const storyData = await this.getStoryData(story);
        const outputJs: string[] = [];
        outputJs.push('squiffy.story.js = [');
        for (const js of storyData.js) {
            this.writeJs(outputJs, 1, js);
        }
        outputJs.push('];');

        return `// Created with Squiffy ${squiffyVersion}
// https://github.com/textadventures/squiffy

(function(){
${template}
${outputJs.join('\n')}
squiffy.story = {...squiffy.story, ...${JSON.stringify(storyData.story, null, 4)}};
})();
`;
    }

    async getStoryData(story: Story): Promise<Output> {
        if (!story.start) {
            story.start = Object.keys(story.sections)[0];
        }
        
        const output: Output = {
            story: {
                start: story.start,
                id: story.id,
                sections: {},
            },
            js: [],
        };

        for (const sectionName of Object.keys(story.sections)) {
            const section = story.sections[sectionName];
            const outputSection: OutputSection = {};
            output.story.sections[sectionName] = outputSection;

            if (section.clear) {
                outputSection.clear = true;
            }

            outputSection.text = await this.processText(section.text.join('\n'), story, section, null);

            if (section.attributes.length > 0) {
                outputSection.attributes = section.attributes;
            }
            if (section.js.length > 0) {
                output.js.push(section.js);
                outputSection.jsIndex = output.js.length - 1;
            }
            if ('@last' in section.passages) {
                var passageCount = 0;
                for (const passageName of Object.keys(section.passages)) {
                    if (passageName?.substring(0, 1) !== '@') {
                        passageCount++;
                    }
                }
                outputSection.passageCount = passageCount;
            }

            if (Object.keys(section.passages).length == 0) continue;

            outputSection.passages = {};

            for (const passageName of Object.keys(section.passages)) {
                const passage = section.passages[passageName];
                const outputPassage: OutputPassage = {};
                outputSection.passages[passageName] = outputPassage;

                if (passage.clear) {
                    outputPassage.clear = true;
                }

                outputPassage.text = await this.processText(passage.text.join('\n'), story, section, passage);
                
                if (passage.attributes.length > 0) {
                    outputPassage.attributes = passage.attributes;
                }
                if (passage.js.length > 0) {
                    output.js.push(passage.js);
                    outputPassage.jsIndex = output.js.length - 1;
                }
            }
        }

        return output;
    };

    findFile(filename: string, outputPath: string /*, sourcePath: string */) {
        if (outputPath) {
            var outputPathFile = path.join(outputPath, filename);
            if (fs.existsSync(outputPathFile)) {
                return outputPathFile;
            }
        }
        return path.join(import.meta.dirname, filename);
    };

    regex: Record<string, RegExp> = {
        section: /^\[\[(.*)\]\]:$/,
        passage: /^\[(.*)\]:$/,
        title: /^@title (.*)$/,
        import: /^@import (.*)$/,
        start: /^@start (.*)$/,
        attributes: /^@set (.*)$/,
        unset: /^@unset (.*)$/,
        inc: /^@inc (\S+)(?: (\d+))?$/,
        dec: /^@dec (\S+)(?: (\d+))?$/,
        replace: /^@replace (.*$)/,
        js: /^(\t| {4})(.*)$/,
        continue: /^\+\+\+(.*)$/,
    };

    async processFile(story: Story, inputFilename: string, isFirst: boolean) {
        if (story.files.includes(inputFilename)) {
            return true;
        }

        story.files.push(inputFilename);
        console.log('Loading ' + inputFilename);

        var inputFile = fs.readFileSync(inputFilename);
        var inputText = inputFile.toString();

        return await this.processFileText(story, inputText, inputFilename, isFirst);
    };

    async processFileText(story: Story, inputText: string, inputFilename: string, isFirst: boolean) {
        var inputLines = inputText.replace(/\r/g, '').split('\n');

        var compiler = this;
        var lineCount = 0;
        var autoSectionCount = 0;
        var section: Section | null = null;
        var passage = null as Passage | null;   // annotated differently to section, as a workaround for TypeScript "Property does not exist on type never"
        var textStarted = false;
        var ensureSectionExists = function () {
            return compiler.ensureSectionExists(story, section, isFirst, inputFilename, lineCount);
        };

        let result = true;

        for (const line of inputLines) {
            var stripLine = line.trim();
            lineCount++;

            var match: Record<string, RegExpExecArray | null> = {};

            for (const key of Object.keys(this.regex)) {
                const regex = this.regex[key];
                match[key] = key == 'js' ? regex.exec(line) : regex.exec(stripLine);
            }

            if (match.section) {
                section = story.addSection(match.section[1], inputFilename, lineCount);
                passage = null;
                textStarted = false;
            }
            else if (match.passage) {
                if (!section) {
                    console.log(`ERROR: ${inputFilename} line ${lineCount}: Can\'t add passage "${match.passage[1]}" as no section has been created.`);
                    result = false;
                    continue;
                }
                section = ensureSectionExists();
                passage = section.addPassage(match.passage[1], lineCount);
                textStarted = false;
            }
            else if (match.continue) {
                section = ensureSectionExists();
                autoSectionCount++;
                var autoSectionName = `_continue${autoSectionCount}`;
                section.addText(`[[${match.continue[1]}]](${autoSectionName})`);
                section = story.addSection(autoSectionName, inputFilename, lineCount);
                passage = null;
                textStarted = false;
            }
            else if (stripLine == '@clear') {
                if (!passage) {
                    section = ensureSectionExists();
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
            // else if (match.import && inputFilename) {
            //     var basePath = path.resolve(path.dirname(inputFilename));
            //     var newFilenames = path.join(basePath, match.import[1]);
            //     var importFilenames = glob.sync(newFilenames);
            //     importFilenames.every(function (importFilename) {
            //         if (importFilename.endsWith('.squiffy')) {
            //             var success = await this.processFile(story, importFilename, false);
            //             if (!success) return false;
            //         }
            //         else if (importFilename.endsWith('.js')) {
            //             story.scripts.push(path.relative(basePath, importFilename));
            //         }
            //         else if (importFilename.endsWith('.css')) {
            //             story.stylesheets.push(path.relative(basePath, importFilename));
            //         }

            //         return true;
            //     }, this);
            // }
            else if (match.attributes) {
                section = ensureSectionExists();
                section = this.addAttribute(match.attributes[1], story, section!, passage, isFirst, inputFilename, lineCount);
            }
            else if (match.unset) {
                section = ensureSectionExists();
                section = this.addAttribute('not ' + match.unset[1], story, section!, passage, isFirst, inputFilename, lineCount);
            }
            else if (match.inc) {
                section = ensureSectionExists();
                section = this.addAttribute(match.inc[1] + '+=' + (match.inc[2] === undefined ? '1' : match.inc[2]), story, section!, passage, isFirst, inputFilename, lineCount);
            }
            else if (match.dec) {
                section = ensureSectionExists();
                section = this.addAttribute(match.dec[1] + '-=' + (match.dec[2] === undefined ? '1' : match.dec[2]), story, section!, passage, isFirst, inputFilename, lineCount);
            }
            else if (match.replace) {
                section = ensureSectionExists();
                var replaceAttribute = match.replace[1];
                var attributeMatch = /^(.*?)=(.*)$/.exec(replaceAttribute);
                if (attributeMatch) {
                    replaceAttribute = attributeMatch[1] + '=' + await this.processText(attributeMatch[2], null!, null!, null!);
                }
                section = this.addAttribute('@replace ' + replaceAttribute, story, section!, passage, isFirst, inputFilename, lineCount);
            }
            else if (!textStarted && match.js) {
                if (!passage) {
                    section = ensureSectionExists();
                    section.addJS(match.js[2]);
                }
                else {
                    passage.addJS(match.js[2]);
                }
            }
            else if (textStarted || stripLine.length > 0) {
                if (!passage) {
                    section = ensureSectionExists();
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
        }
        
        return result;
    };

    ensureSectionExists(story: Story, section: Section | null, isFirst: boolean, inputFilename: string, lineCount: number) {
        if (!section && isFirst) {
            section = story.addSection('_default', inputFilename, lineCount);
        }
        return section!;
    };

    addAttribute(attribute: string, story: Story, section: Section, passage: Passage | null, isFirst: boolean, inputFilename: string, lineCount: number) {
        if (!passage) {
            section = this.ensureSectionExists(story, section, isFirst, inputFilename, lineCount);
            section.addAttribute(attribute);
        }
        else {
            passage.addAttribute(attribute);
        }
        return section;
    };

    async processText(input: string, story: Story, section: Section, passage: Passage | null) {
        // namedSectionLinkRegex matches:
        //   open [[
        //   any text - the link text
        //   closing ]]
        //   open bracket
        //   any text - the name of the section
        //   closing bracket
        var namedSectionLinkRegex = /\[\[([^\]]*?)\]\]\((.*?)\)/g;

        var links = this.allMatchesForGroup(input, namedSectionLinkRegex, 2);
        this.checkSectionLinks(story, links, section, passage);

        input = input.replace(namedSectionLinkRegex, '<a class="squiffy-link link-section" data-section="$2" role="link" tabindex="0">$1</a>');

        // namedPassageLinkRegex matches:
        //   open [
        //   any text - the link text
        //   closing ]
        //   open bracket, but not http(s):// after it
        //   any text - the name of the passage
        //   closing bracket
        var namedPassageLinkRegex = /\[([^\]]*?)\]\(((?!https?:\/\/).*?)\)/g;

        links = this.allMatchesForGroup(input, namedPassageLinkRegex, 2);
        this.checkPassageLinks(story, links, section, passage);

        input = input.replace(namedPassageLinkRegex, '<a class="squiffy-link link-passage" data-passage="$2" role="link" tabindex="0">$1</a>');

        // unnamedSectionLinkRegex matches:
        //   open [[
        //   any text - the link text
        //   closing ]]
        var unnamedSectionLinkRegex = /\[\[(.*?)\]\]/g;

        links = this.allMatchesForGroup(input, unnamedSectionLinkRegex, 1);
        this.checkSectionLinks(story, links, section, passage);

        input = input.replace(unnamedSectionLinkRegex, '<a class="squiffy-link link-section" data-section="$1" role="link" tabindex="0">$1</a>');

        // unnamedPassageLinkRegex matches:
        //   open [
        //   any text - the link text
        //   closing ]
        //   no bracket after
        var unnamedPassageLinkRegex = /\[(.*?)\]([^\(]|$)/g;

        links = this.allMatchesForGroup(input, unnamedPassageLinkRegex, 1);
        this.checkPassageLinks(story, links, section, passage);

        input = input.replace(unnamedPassageLinkRegex, '<a class="squiffy-link link-passage" data-passage="$1" role="link" tabindex="0">$1</a>$2');

        return (await marked.parse(input)).trim();
    };

    allMatchesForGroup(input: string, regex: RegExp, groupNumber: number) {
        var result = [];
        var match;
        while (!!(match = regex.exec(input))) {
            result.push(match[groupNumber]);
        }
        return result;
    };

    checkSectionLinks(story: Story, links: string[], section: Section, passage: Passage | null) {
        if (!story) return;
        var badLinks = links.filter(m => !this.linkDestinationExists(m, story.sections));
        this.showBadLinksWarning(badLinks, 'section', '[[', ']]', section, passage);
    };

    checkPassageLinks(story: Story, links: string[], section: Section, passage: Passage | null) {
        if (!story) return;
        var badLinks = links.filter(m => !this.linkDestinationExists(m, section.passages));
        this.showBadLinksWarning(badLinks, 'passage', '[', ']', section, passage);
    };

    linkDestinationExists(link: string, keys: Record<string, any>) {
        // Link destination data may look like:
        //   passageName
        //   passageName, my_attribute=2
        //   passageName, @replace 1=new text, some_attribute=5
        //   @replace 2=some words
        // We're only interested in checking if the named passage or section exists.

        var linkDestination = link.split(',')[0];
        if (linkDestination.substring(0, 1) == '@') {
            return true;
        }
        return Object.keys(keys).includes(linkDestination);
    };

    showBadLinksWarning(badLinks: string[], linkTo: string, before: string, after: string, section: Section, passage: Passage | null) {
        for (const badLink of badLinks) {
            var warning;
            if (!passage) {
                warning = `${section.filename} line ${section.line}: In section '${section.name}'`;
            }
            else {
                warning = `${section.filename} line ${passage.line}: In section '${section.name}', passage '${passage.name}'`;
            }
            console.log(`WARNING: ${warning} there is a link to a ${linkTo} called ${before}${badLink}${after}, which doesn't exist`);
        }
    };

    writeJs(outputJsFile: string[], tabCount: number, js: string[]) {
        var tabs = new Array(tabCount + 1).join('\t');
        outputJsFile.push(`${tabs}function() {\n`);
        for (const jsLine of js) {
            outputJsFile.push(`${tabs}\t${jsLine}\n`);
        }
        outputJsFile.push(`${tabs}},\n`);
    };
}

class Story {
    sections: Record<string, Section> = {};
    title = '';
    scripts = [];
    stylesheets = [];
    files: string[] = [];
    start = '';
    id: string | null = null;

    addSection(name: string, filename: string, line: number): Section {
        const section = new Section(name, filename, line);
        this.sections[name] = section;
        return section;
    };

    set_id(filename: string) {
        var shasum = crypto.createHash('sha1');
        shasum.update(filename);
        this.id = shasum.digest('hex').substring(0, 10);
    };
}

class Section {
    constructor(name: string, filename: string, line: number) {
        this.name = name;
        this.filename = filename;
        this.line = line;
    }

    name: string;
    filename: string;
    line: number;

    text: string[] = [];
    passages: Record<string, Passage> = {};
    js: string[] = [];
    clear = false;
    attributes: string[] = [];

    addPassage(name: string, line: number) {
        var passage = new Passage(name, line);
        this.passages[name] = passage;
        return passage;
    };

    addText(text: string) {
        this.text.push(text);
    };

    addJS(text: string) {
        this.js.push(text);
    };

    addAttribute(text: string) {
        this.attributes.push(text);
    };
}

class Passage {
    constructor(name: string, line: number) {
        this.name = name;
        this.line = line;
    }
    name: string;
    line: number;

    text: string[] = [];
    js: string[] = [];
    clear = false;
    attributes: string[] = [];

    addText(text: string) {
        this.text.push(text);
    };

    addJS(text: string) {
        this.js.push(text);
    };

    addAttribute(text: string) {
        this.attributes.push(text);
    };
}