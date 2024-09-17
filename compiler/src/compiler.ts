import * as marked from 'marked';
import * as crypto from 'crypto';
import { SQUIFFY_VERSION } from './version.js';

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

interface CompilerSettings {
    scriptBaseFilename: string,
    script: string,
    onWarning?: (message: string) => void;
}

export class Compiler {
    private settings: CompilerSettings;
    private story: Story;

    constructor(settings: CompilerSettings) {
        this.settings = settings;
        this.story = new Story(settings.scriptBaseFilename);
    }

    async getJs(template: string /*, options */) {
        // When calling from Vite, can set template this way:
        // const template = (await import('./squiffy.template.js?raw')).default;

        const storyData = await this.getStoryData();
        const outputJs: string[] = [];
        outputJs.push('squiffy.story.js = [');
        for (const js of storyData.js) {
            this.writeJs(outputJs, 1, js);
        }
        outputJs.push('];');

        return `// Created with Squiffy ${SQUIFFY_VERSION}
// https://github.com/textadventures/squiffy

${template}
${outputJs.join('\n')}
squiffy.story = {...squiffy.story, ...${JSON.stringify(storyData.story, null, 4)}};
`;
    }

    async getStoryData(): Promise<Output> {
        if (!this.story.start) {
            this.story.start = Object.keys(this.story.sections)[0];
        }
        
        const output: Output = {
            story: {
                start: this.story.start,
                id: this.story.id,
                sections: {},
            },
            js: [],
        };

        for (const sectionName of Object.keys(this.story.sections)) {
            const section = this.story.sections[sectionName];
            const outputSection: OutputSection = {};
            output.story.sections[sectionName] = outputSection;

            if (section.clear) {
                outputSection.clear = true;
            }

            outputSection.text = await this.processText(section.text.join('\n'), section, null);

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

                outputPassage.text = await this.processText(passage.text.join('\n'), section, passage);
                
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

    private regex: Record<string, RegExp> = {
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

    async load() {
        return await this.processFileText(this.settings.script, this.settings.scriptBaseFilename, true);
    }

    private async processFileText(inputText: string, inputFilename: string, isFirst: boolean) {
        var inputLines = inputText.replace(/\r/g, '').split('\n');

        var lineCount = 0;
        var autoSectionCount = 0;
        var section: Section | null = null;
        var passage = null as Passage | null;   // annotated differently to section, as a workaround for TypeScript "Property does not exist on type never"
        var textStarted = false;
        var ensureSectionExists = () => {
            return this.ensureSectionExists(section, isFirst, inputFilename, lineCount);
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
                section = this.story.addSection(match.section[1], inputFilename, lineCount);
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
                section = this.story.addSection(autoSectionName, inputFilename, lineCount);
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
                this.story.title = match.title[1];
            }
            else if (match.start) {
                this.story.start = match.start[1];
            }
            
            // TODO: When handling @import, keep track of which files have been included already. Don't include them again.

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
                section = this.addAttribute(match.attributes[1], section!, passage, isFirst, inputFilename, lineCount);
            }
            else if (match.unset) {
                section = ensureSectionExists();
                section = this.addAttribute('not ' + match.unset[1], section!, passage, isFirst, inputFilename, lineCount);
            }
            else if (match.inc) {
                section = ensureSectionExists();
                section = this.addAttribute(match.inc[1] + '+=' + (match.inc[2] === undefined ? '1' : match.inc[2]), section, passage, isFirst, inputFilename, lineCount);
            }
            else if (match.dec) {
                section = ensureSectionExists();
                section = this.addAttribute(match.dec[1] + '-=' + (match.dec[2] === undefined ? '1' : match.dec[2]), section, passage, isFirst, inputFilename, lineCount);
            }
            else if (match.replace) {
                section = ensureSectionExists();
                var replaceAttribute = match.replace[1];
                var attributeMatch = /^(.*?)=(.*)$/.exec(replaceAttribute);
                if (attributeMatch) {
                    replaceAttribute = attributeMatch[1] + '=' + await this.processText(attributeMatch[2], section, null);
                }
                section = this.addAttribute('@replace ' + replaceAttribute, section!, passage, isFirst, inputFilename, lineCount);
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

    private ensureSectionExists(section: Section | null, isFirst: boolean, inputFilename: string, lineCount: number) {
        if (!section && isFirst) {
            section = this.story.addSection('_default', inputFilename, lineCount);
        }
        return section!;
    };

    private addAttribute(attribute: string, section: Section, passage: Passage | null, isFirst: boolean, inputFilename: string, lineCount: number) {
        if (!passage) {
            section = this.ensureSectionExists(section, isFirst, inputFilename, lineCount);
            section.addAttribute(attribute);
        }
        else {
            passage.addAttribute(attribute);
        }
        return section;
    };

    private async processText(input: string, section: Section, passage: Passage | null) {
        // namedSectionLinkRegex matches:
        //   open [[
        //   any text - the link text
        //   closing ]]
        //   open bracket
        //   any text - the name of the section
        //   closing bracket
        var namedSectionLinkRegex = /\[\[([^\]]*?)\]\]\((.*?)\)/g;

        var links = this.allMatchesForGroup(input, namedSectionLinkRegex, 2);
        this.checkSectionLinks(links, section, passage);

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
        this.checkPassageLinks(links, section, passage);

        input = input.replace(namedPassageLinkRegex, '<a class="squiffy-link link-passage" data-passage="$2" role="link" tabindex="0">$1</a>');

        // unnamedSectionLinkRegex matches:
        //   open [[
        //   any text - the link text
        //   closing ]]
        var unnamedSectionLinkRegex = /\[\[(.*?)\]\]/g;

        links = this.allMatchesForGroup(input, unnamedSectionLinkRegex, 1);
        this.checkSectionLinks(links, section, passage);

        input = input.replace(unnamedSectionLinkRegex, '<a class="squiffy-link link-section" data-section="$1" role="link" tabindex="0">$1</a>');

        // unnamedPassageLinkRegex matches:
        //   open [
        //   any text - the link text
        //   closing ]
        //   no bracket after
        var unnamedPassageLinkRegex = /\[(.*?)\]([^\(]|$)/g;

        links = this.allMatchesForGroup(input, unnamedPassageLinkRegex, 1);
        this.checkPassageLinks(links, section, passage);

        input = input.replace(unnamedPassageLinkRegex, '<a class="squiffy-link link-passage" data-passage="$1" role="link" tabindex="0">$1</a>$2');

        return (await marked.parse(input)).trim();
    };

    private allMatchesForGroup(input: string, regex: RegExp, groupNumber: number) {
        var result = [];
        var match;
        while (!!(match = regex.exec(input))) {
            result.push(match[groupNumber]);
        }
        return result;
    };

    private checkSectionLinks(links: string[], section: Section, passage: Passage | null) {
        var badLinks = links.filter(m => !this.linkDestinationExists(m, this.story.sections));
        this.showBadLinksWarning(badLinks, 'section', '[[', ']]', section, passage);
    };

    private checkPassageLinks(links: string[], section: Section, passage: Passage | null) {
        var badLinks = links.filter(m => !this.linkDestinationExists(m, section.passages));
        this.showBadLinksWarning(badLinks, 'passage', '[', ']', section, passage);
    };

    private linkDestinationExists(link: string, keys: Record<string, any>) {
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

    private showBadLinksWarning(badLinks: string[], linkTo: string, before: string, after: string, section: Section, passage: Passage | null) {
        if (!this.settings.onWarning) return;
        
        for (const badLink of badLinks) {
            var warning;
            if (!passage) {
                warning = `${section.filename} line ${section.line}: In section '${section.name}'`;
            }
            else {
                warning = `${section.filename} line ${passage.line}: In section '${section.name}', passage '${passage.name}'`;
            }
            this.settings.onWarning(`WARNING: ${warning} there is a link to a ${linkTo} called ${before}${badLink}${after}, which doesn't exist`);
        }
    };

    private writeJs(outputJsFile: string[], tabCount: number, js: string[]) {
        var tabs = new Array(tabCount + 1).join('\t');
        outputJsFile.push(`${tabs}function() {\n`);
        for (const jsLine of js) {
            outputJsFile.push(`${tabs}\t${jsLine}\n`);
        }
        outputJsFile.push(`${tabs}},\n`);
    };

    getUiInfo() {
        return {
            title: this.story.title,
            externalScripts: this.story.scripts,
            externalStylesheets: this.story.stylesheets,
        }
    };
}

class Story {
    sections: Record<string, Section> = {};
    title = '';
    scripts = [];
    stylesheets = [];
    start = '';
    id: string | null = null;

    constructor(inputFilename: string) {
        var shasum = crypto.createHash('sha1');
        shasum.update(inputFilename);
        this.id = shasum.digest('hex').substring(0, 10);
    }

    addSection(name: string, filename: string, line: number): Section {
        const section = new Section(name, filename, line);
        this.sections[name] = section;
        return section;
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