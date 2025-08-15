import * as marked from 'marked';

export const SQUIFFY_VERSION = '6.0.0-alpha.2';

export interface Output {
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
    scriptBaseFilename?: string;
    script: string;
    onWarning?: (message: string) => void;
    externalFiles?: ExternalFiles;
}

interface ExternalFiles {
    getMatchingFilenames(pattern: string): Promise<string[]>;
    getContent(filename: string): Promise<string>;
    getLocalFilename(filename: string): string;
}

interface UiInfo {
    title: string;
    externalScripts: string[];
    externalStylesheets: string[];
}

export interface CompileSuccess {
    success: true;
    output: Output;
    getJs: (excludeHeader?: boolean) => Promise<string>;
    getUiInfo: () => UiInfo;
}

export interface CompileError {
    success: false;
    errors: string[];
}

export async function compile(settings: CompilerSettings): Promise<CompileSuccess | CompileError> {
    const story = new Story(settings.scriptBaseFilename);
    const errors: string[] = [];

    async function getJs(storyData: Output, excludeHeader: boolean) {
        const outputJs: string[] = [];
        if (!excludeHeader) {
            outputJs.push(`// Created with Squiffy ${SQUIFFY_VERSION}`);
            outputJs.push('// https://github.com/textadventures/squiffy');
        }
        outputJs.push('export const story = {};');
        outputJs.push(`story.id = ${JSON.stringify(storyData.story.id, null, 4)};`);
        outputJs.push(`story.start = ${JSON.stringify(storyData.story.start, null, 4)};`);
        outputJs.push(`story.sections = ${JSON.stringify(storyData.story.sections, null, 4)};`);
        outputJs.push('story.js = [');
        for (const js of storyData.js) {
            writeJs(outputJs, 1, js);
        }
        outputJs.push('];');

        return outputJs.join('\n');
    }

    async function getStoryData(): Promise<Output> {
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

            outputSection.text = await processText(section.text.join('\n'), section, null);

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
                    if (passageName.length > 0 && passageName?.substring(0, 1) !== '@') {
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

                outputPassage.text = await processText(passage.text.join('\n'), section, passage);
                
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

    const regexes: Record<string, RegExp> = {
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

    async function processFileText(inputText: string, inputFilename: string | undefined, isFirst: boolean) {
        var inputLines = inputText.replace(/\r/g, '').split('\n');

        var lineCount = 0;
        var autoSectionCount = 0;
        var section: Section | null = null;
        var passage = null as Passage | null;   // annotated differently to section, as a workaround for TypeScript "Property does not exist on type never"
        var textStarted = false;
        var ensureThisSectionExists = () => {
            return ensureSectionExists(section, isFirst, inputFilename, lineCount);
        };

        const secondPass: (() => Promise<void>)[] = [];

        for (const line of inputLines) {
            var stripLine = line.trim();
            lineCount++;

            var match: Record<string, RegExpExecArray | null> = {};

            for (const key of Object.keys(regexes)) {
                const regex = regexes[key];
                match[key] = key == 'js' ? regex.exec(line) : regex.exec(stripLine);
            }

            if (match.section) {
                section = story.addSection(match.section[1], inputFilename, lineCount);
                passage = null;
                textStarted = false;
            }
            else if (match.passage) {
                if (!section) {
                    errors.push(`ERROR: ${inputFilename} line ${lineCount}: Can\'t add passage "${match.passage[1]}" as no section has been created.`);
                    return false;
                }
                section = ensureThisSectionExists();
                passage = section.addPassage(match.passage[1], lineCount);
                textStarted = false;
            }
            else if (match.continue) {
                section = ensureThisSectionExists();
                autoSectionCount++;
                var autoSectionName = `_continue${autoSectionCount}`;
                section.addText(`[[${match.continue[1]}]](${autoSectionName})`);
                section = story.addSection(autoSectionName, inputFilename, lineCount);
                passage = null;
                textStarted = false;
            }
            else if (stripLine == '@clear') {
                if (!passage) {
                    section = ensureThisSectionExists();
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
            else if (match.import && settings.externalFiles) {
                var importFilenames = await settings.externalFiles.getMatchingFilenames(match.import[1]);

                for (const importFilename of importFilenames) {
                    if (importFilename.endsWith('.squiffy')) {
                        const content = await settings.externalFiles.getContent(importFilename);
                        var success = await processFileText(content, importFilename, false);
                        if (!success) return false;
                    }
                    else if (importFilename.endsWith('.js')) {
                        story.scripts.push(settings.externalFiles.getLocalFilename(importFilename));
                    }
                    else if (importFilename.endsWith('.css')) {
                        story.stylesheets.push(settings.externalFiles.getLocalFilename(importFilename));
                    }
                }
            }
            else if (match.attributes) {
                section = ensureThisSectionExists();
                section = addAttribute(match.attributes[1], section!, passage, isFirst, inputFilename, lineCount);
            }
            else if (match.unset) {
                section = ensureThisSectionExists();
                section = addAttribute('not ' + match.unset[1], section!, passage, isFirst, inputFilename, lineCount);
            }
            else if (match.inc) {
                section = ensureThisSectionExists();
                section = addAttribute(match.inc[1] + '+=' + (match.inc[2] === undefined ? '1' : match.inc[2]), section, passage, isFirst, inputFilename, lineCount);
            }
            else if (match.dec) {
                section = ensureThisSectionExists();
                section = addAttribute(match.dec[1] + '-=' + (match.dec[2] === undefined ? '1' : match.dec[2]), section, passage, isFirst, inputFilename, lineCount);
            }
            else if (match.replace) {
                const thisSection = ensureThisSectionExists();
                const thisPassage = passage;
                var replaceAttribute = match.replace[1];
                var attributeMatch = /^(.*?)=(.*)$/.exec(replaceAttribute);
                secondPass.push(async () => {
                    // add this to secondPass functions, because processText might result in links to passages which have not been created yet
                    if (attributeMatch) {
                        replaceAttribute = attributeMatch[1] + '=' + await processText(attributeMatch[2], thisSection, null);
                    }
                    addAttribute('@replace ' + replaceAttribute, section!, thisPassage, isFirst, inputFilename, lineCount);
                });
            }
            else if (!textStarted && match.js) {
                if (!passage) {
                    section = ensureThisSectionExists();
                    section.addJS(match.js[2]);
                }
                else {
                    passage.addJS(match.js[2]);
                }
            }
            else if (textStarted || stripLine.length > 0) {
                if (!passage) {
                    section = ensureThisSectionExists();
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

        for (const fn of secondPass) {
            await fn();
        }
        
        return true;
    };

    function ensureSectionExists(section: Section | null, isFirst: boolean, inputFilename: string | undefined, lineCount: number) {
        if (!section && isFirst) {
            section = story.addSection('_default', inputFilename, lineCount);
        }
        return section!;
    };

    function addAttribute(attribute: string, section: Section, passage: Passage | null, isFirst: boolean, inputFilename: string | undefined, lineCount: number) {
        if (!passage) {
            section = ensureSectionExists(section, isFirst, inputFilename, lineCount);
            section.addAttribute(attribute);
        }
        else {
            passage.addAttribute(attribute);
        }
        return section;
    };

    async function processText(input: string, section: Section, passage: Passage | null) {
        // namedSectionLinkRegex matches:
        //   open [[
        //   any text - the link text
        //   closing ]]
        //   open bracket
        //   any text - the name of the section
        //   closing bracket
        var namedSectionLinkRegex = /\[\[([^\]]*?)\]\]\((.*?)\)/g;

        var links = allMatchesForGroup(input, namedSectionLinkRegex, 2);
        checkSectionLinks(links, section, passage);

        input = input.replace(namedSectionLinkRegex, '<a class="squiffy-link link-section" data-section="$2" role="link" tabindex="0">$1</a>');

        // namedPassageLinkRegex matches:
        //   open [
        //   any text - the link text
        //   closing ]
        //   open bracket, but not http(s):// after it
        //   any text - the name of the passage
        //   closing bracket
        var namedPassageLinkRegex = /\[([^\]]*?)\]\(((?!https?:\/\/).*?)\)/g;

        links = allMatchesForGroup(input, namedPassageLinkRegex, 2);
        checkPassageLinks(links, section, passage);

        input = input.replace(namedPassageLinkRegex, '<a class="squiffy-link link-passage" data-passage="$2" role="link" tabindex="0">$1</a>');

        // unnamedSectionLinkRegex matches:
        //   open [[
        //   any text - the link text
        //   closing ]]
        var unnamedSectionLinkRegex = /\[\[(.*?)\]\]/g;

        links = allMatchesForGroup(input, unnamedSectionLinkRegex, 1);
        checkSectionLinks(links, section, passage);

        input = input.replace(unnamedSectionLinkRegex, '<a class="squiffy-link link-section" data-section="$1" role="link" tabindex="0">$1</a>');

        // unnamedPassageLinkRegex matches:
        //   open [
        //   any text - the link text
        //   closing ]
        //   no bracket after
        var unnamedPassageLinkRegex = /\[(.*?)\]([^\(]|$)/g;

        links = allMatchesForGroup(input, unnamedPassageLinkRegex, 1);
        checkPassageLinks(links, section, passage);

        input = input.replace(unnamedPassageLinkRegex, '<a class="squiffy-link link-passage" data-passage="$1" role="link" tabindex="0">$1</a>$2');

        return (await marked.parse(input)).trim();
    };

    function allMatchesForGroup(input: string, regex: RegExp, groupNumber: number) {
        var result = [];
        var match;
        while (!!(match = regex.exec(input))) {
            result.push(match[groupNumber]);
        }
        return result;
    };

    function checkSectionLinks(links: string[], section: Section, passage: Passage | null) {
        var badLinks = links.filter(m => !linkDestinationExists(m, story.sections));
        showBadLinksWarning(badLinks, 'section', '[[', ']]', section, passage);
    };

    function checkPassageLinks(links: string[], section: Section, passage: Passage | null) {
        var badLinks = links.filter(m => !linkDestinationExists(m, section.passages));
        showBadLinksWarning(badLinks, 'passage', '[', ']', section, passage);
    };

    function linkDestinationExists(link: string, keys: Record<string, any>) {
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

    function showBadLinksWarning(badLinks: string[], linkTo: string, before: string, after: string, section: Section, passage: Passage | null) {
        if (!settings.onWarning) return;
        
        for (const badLink of badLinks) {
            var warning;
            if (!passage) {
                warning = `${section.filename} line ${section.line}: In section '${section.name}'`;
            }
            else {
                warning = `${section.filename} line ${passage.line}: In section '${section.name}', passage '${passage.name}'`;
            }
            settings.onWarning(`WARNING: ${warning} there is a link to a ${linkTo} called ${before}${badLink}${after}, which doesn't exist`);
        }
    };

    function writeJs(outputJsFile: string[], tabCount: number, js: string[]) {
        var tabs = new Array(tabCount + 1).join('\t');
        outputJsFile.push(`${tabs}(squiffy, get, set) => {`);
        for (const jsLine of js) {
            outputJsFile.push(`${tabs}\t${jsLine}`);
        }
        outputJsFile.push(`${tabs}},`);
    };

    const success = await processFileText(settings.script, settings.scriptBaseFilename, true);

    if (success) {
        const storyData = await getStoryData();

        return {
            success: true,
            output: storyData,
            getJs: (excludeHeader?: boolean) => {
                return getJs(storyData, excludeHeader || false);
            },
            getUiInfo: () => {
                return {
                    title: story.title,
                    externalScripts: story.scripts,
                    externalStylesheets: story.stylesheets,
                }
            }
        }
    }
    else {
        return {
            success: false,
            errors: errors
        }
    }
}

class Story {
    sections: Record<string, Section> = {};
    title = '';
    scripts: string[] = [];
    stylesheets: string[] = [];
    start = '';
    id: string | null = null;

    constructor(inputFilename?: string) {
        this.id = inputFilename || null;
    }

    addSection(name: string, filename: string | undefined, line: number): Section {
        const section = new Section(name, filename, line);
        this.sections[name] = section;
        return section;
    };
}

class Section {
    constructor(name: string, filename: string | undefined, line: number) {
        this.name = name;
        this.filename = filename;
        this.line = line;
    }

    name: string;
    filename: string | undefined;
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