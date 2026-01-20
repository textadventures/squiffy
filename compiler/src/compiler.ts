import pkg from "../package.json" with { type: "json" };
const version = pkg.version;

export interface Output {
    story: OutputStory;
    js: string[][];
}

interface OutputStory {
    start: string;
    id: string | null;
    uiJsIndex?: number;
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
    globalJs?: boolean;
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
    const story = new Story();
    const errors: string[] = [];
    let autoSectionCount = 0;

    async function getJs(storyData: Output, excludeHeader: boolean) {
        const outputJs: string[] = [];
        if (!excludeHeader) {
            outputJs.push(`// Created with Squiffy ${version}`);
            outputJs.push("// https://github.com/textadventures/squiffy");
        }
        if (settings.globalJs) {
            outputJs.push("var story = {};");
        }
        else {
            outputJs.push("export const story = {};");
        }
        outputJs.push(`story.id = ${JSON.stringify(storyData.story.id, null, 4)};`);
        if (storyData.story.uiJsIndex !== undefined) {
            outputJs.push(`story.uiJsIndex = ${storyData.story.uiJsIndex};`);
        }
        outputJs.push(`story.start = ${JSON.stringify(storyData.story.start, null, 4)};`);
        outputJs.push(`story.sections = ${JSON.stringify(storyData.story.sections, null, 4)};`);
        outputJs.push("story.js = [");
        for (const js of storyData.js) {
            writeJs(outputJs, 1, js);
        }
        outputJs.push("];");

        return outputJs.join("\n");
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

        if (story.uiJs.length > 0) {
            output.js.push(story.uiJs);
            output.story.uiJsIndex = output.js.length - 1;
        }

        for (const sectionName of Object.keys(story.sections)) {
            const section = story.sections[sectionName];
            const outputSection: OutputSection = {};
            output.story.sections[sectionName] = outputSection;

            if (section.clear) {
                outputSection.clear = true;
            }

            outputSection.text = await processText(section.text.join("\n"), section, null);

            if (section.attributes.length > 0) {
                outputSection.attributes = section.attributes;
            }
            if (section.js.length > 0) {
                output.js.push(section.js);
                outputSection.jsIndex = output.js.length - 1;
            }
            if ("@last" in section.passages) {
                let passageCount = 0;
                for (const passageName of Object.keys(section.passages)) {
                    if (passageName.length > 0 && passageName?.substring(0, 1) !== "@") {
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

                outputPassage.text = await processText(passage.text.join("\n"), section, passage);
                
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
    }

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
        js: /^(\t| {4})(.*)$/,
        continue: /^\+\+\+(.*)$/,
        ui: /^@ui (.*)$/,
    };

    async function processFileText(inputText: string, inputFilename: string | undefined, isFirst: boolean) {
        const inputLines = inputText.replace(/\r/g, "").split("\n");

        let lineCount = 0;
        let section: Section | null = null;
        let passage = null as Passage | null;   // annotated differently to section, as a workaround for TypeScript "Property does not exist on type never"
        let textStarted = false;
        let inUiBlock = false;
        const ensureThisSectionExists = () => {
            return ensureSectionExists(section, isFirst, inputFilename, lineCount);
        };
        const addAutoSection = () => {
            autoSectionCount++;
            const autoSectionName = `_continue${autoSectionCount}`;
            section = story.addSection(autoSectionName, inputFilename, lineCount);
            passage = null;
            textStarted = false;
            return autoSectionName;
        };

        for (const line of inputLines) {
            const stripLine = line.trim();
            lineCount++;

            const match: Record<string, RegExpExecArray> = {};

            for (const key of Object.keys(regexes)) {
                const regex = regexes[key];
                const result = key == "js" ? regex.exec(line) : regex.exec(stripLine);
                if (result) {
                    match[key] = result;
                }
            }

            if (match.section) {
                section = story.addSection(match.section[1], inputFilename, lineCount);
                passage = null;
                textStarted = false;
            }
            else if (match.passage) {
                if (!section) {
                    errors.push(`ERROR: ${inputFilename} line ${lineCount}: Can't add passage "${match.passage[1]}" as no section has been created.`);
                    return false;
                }
                section = ensureThisSectionExists();
                passage = section.addPassage(match.passage[1], lineCount);
                textStarted = false;
            }
            else if (match.continue) {
                section = ensureThisSectionExists();
                const previousSection = section;
                const autoSectionName = addAutoSection();
                const text = match.continue[1] || "Continue...";
                previousSection.addText(`[[${text}]](${autoSectionName})`);
            }
            else if (stripLine == "---") {
                inUiBlock = false;
                if (!section) {
                    // Just add the _default section if we haven't started yet
                    ensureThisSectionExists();
                }
                else {
                    addAutoSection();
                }
            }
            else if (stripLine == "@ui") {
                inUiBlock = true;
            }
            else if (match.ui && settings.externalFiles) {
                const content = await settings.externalFiles.getContent(match.ui[1]);
                story.addUiJs(content);
            }
            else if (stripLine == "@clear") {
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
                const importFilenames = await settings.externalFiles.getMatchingFilenames(match.import[1]);

                for (const importFilename of importFilenames) {
                    if (importFilename.endsWith(".squiffy")) {
                        const content = await settings.externalFiles.getContent(importFilename);
                        const success = await processFileText(content, importFilename, false);
                        if (!success) return false;
                    }
                    else if (importFilename.endsWith(".js")) {
                        story.scripts.push(settings.externalFiles.getLocalFilename(importFilename));
                    }
                    else if (importFilename.endsWith(".css")) {
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
                section = addAttribute("not " + match.unset[1], section!, passage, isFirst, inputFilename, lineCount);
            }
            else if (match.inc) {
                section = ensureThisSectionExists();
                section = addAttribute(match.inc[1] + "+=" + (match.inc[2] === undefined ? "1" : match.inc[2]), section, passage, isFirst, inputFilename, lineCount);
            }
            else if (match.dec) {
                section = ensureThisSectionExists();
                section = addAttribute(match.dec[1] + "-=" + (match.dec[2] === undefined ? "1" : match.dec[2]), section, passage, isFirst, inputFilename, lineCount);
            }
            else if (!textStarted && match.js) {
                if (inUiBlock) {
                    story.addUiJs(match.js[2]);
                }
                else if (!passage) {
                    section = ensureThisSectionExists();
                    section.addJS(match.js[2]);
                }
                else {
                    passage.addJS(match.js[2]);
                }
            }
            else if (textStarted || stripLine.length > 0) {
                if (inUiBlock) {
                    errors.push(`ERROR: ${inputFilename} line ${lineCount}: Unexpected text in @ui block.`);
                    return false;
                }
                else if (!passage) {
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
        
        return true;
    }

    function ensureSectionExists(section: Section | null, isFirst: boolean, inputFilename: string | undefined, lineCount: number) {
        if (!section && isFirst) {
            section = story.addSection("_default", inputFilename, lineCount);
        }
        return section!;
    }

    function addAttribute(attribute: string, section: Section, passage: Passage | null, isFirst: boolean, inputFilename: string | undefined, lineCount: number) {
        if (!passage) {
            section = ensureSectionExists(section, isFirst, inputFilename, lineCount);
            section.addAttribute(attribute);
        }
        else {
            passage.addAttribute(attribute);
        }
        return section;
    }

    function extractLinkFunctions(link: string): { target: string, setters: string } {
        const fragments = link.split(",");
        return {
            target: fragments[0].trim(),
            setters: fragments.slice(1).join(", ")
        };
    }

    function getAdditionalLinkParameters(link: string): { target: string, additionalParameters: string } {
        const functions = extractLinkFunctions(link);
        let additionalParameters = "";
        if (functions.setters.length > 0) {
            additionalParameters += ` set="${functions.setters}"`;
        }
        return {
            target: functions.target,
            additionalParameters
        };
    }

    async function processText(input: string, section: Section, passage: Passage | null) {
        // Helper to get the next section name
        const getNextSectionName = (): string | null => {
            const sectionNames = Object.keys(story.sections);
            const currentIndex = sectionNames.indexOf(section.name);
            return sectionNames[currentIndex + 1] || null;
        };

        // nextSectionLinkRegex matches [[text>]] - a link to the next section
        const nextSectionLinkRegex = /\[\[([^\]]*?)>\]\]/g;

        input = input.replace(nextSectionLinkRegex, (_match, text) => {
            const nextSectionName = getNextSectionName();
            if (!nextSectionName) {
                settings.onWarning?.(`WARNING: ${section.filename} line ${section.line}: In section '${section.name}', there is a [[${text}>]] link but no following section exists`);
                return `[[${text}]]`; // fallback
            }
            return `{{section "${nextSectionName}" text="${text}"}}`;
        });

        // namedNextSectionLinkRegex matches [[text]](>) or [[text]](>, setter=value)
        // - a named link where target starts with >
        const namedNextSectionLinkRegex = /\[\[([^\]]*?)\]\]\(>(.*?)\)/g;

        input = input.replace(namedNextSectionLinkRegex, (_match, text, rest) => {
            const nextSectionName = getNextSectionName();
            if (!nextSectionName) {
                settings.onWarning?.(`WARNING: ${section.filename} line ${section.line}: In section '${section.name}', there is a [[${text}]](>) link but no following section exists`);
                return `[[${text}]]`; // fallback
            }
            // rest could be empty or ", setter=value"
            const parsedName = getAdditionalLinkParameters(nextSectionName + rest);
            return `{{section "${parsedName.target}" text="${text}"${parsedName.additionalParameters}}}`;
        });

        // namedSectionLinkRegex matches:
        //   open [[
        //   any text - the link text
        //   closing ]]
        //   open bracket
        //   any text - the name of the section
        //   closing bracket
        const namedSectionLinkRegex = /\[\[([^\]]*?)\]\]\((.*?)\)/g;

        let links = allMatchesForGroup(input, namedSectionLinkRegex, 2);
        checkSectionLinks(links, section, passage);

        input = input.replace(namedSectionLinkRegex, (_match, text /* $1 */, name/* $2 */) => {
            const parsedName = getAdditionalLinkParameters(name);
            return `{{section "${parsedName.target}" text="${text}"${parsedName.additionalParameters}}}`;
        });

        // namedPassageLinkRegex matches:
        //   open [
        //   any text - the link text
        //   closing ]
        //   open bracket, but not http(s):// after it
        //   any text - the name of the passage
        //   closing bracket
        const namedPassageLinkRegex = /\[([^\]]*?)\]\(((?!https?:\/\/).*?)\)/g;

        links = allMatchesForGroup(input, namedPassageLinkRegex, 2);
        checkPassageLinks(links, section, passage);

        input = input.replace(namedPassageLinkRegex, (_match, text /* $1 */, name/* $2 */) => {
            const parsedName = getAdditionalLinkParameters(name);
            return `{{passage "${parsedName.target}" text="${text}"${parsedName.additionalParameters}}}`;
        });

        // unnamedSectionLinkRegex matches:
        //   open [[
        //   any text - the link text
        //   closing ]]
        const unnamedSectionLinkRegex = /\[\[(.*?)\]\]/g;

        links = allMatchesForGroup(input, unnamedSectionLinkRegex, 1);
        checkSectionLinks(links, section, passage);

        input = input.replace(unnamedSectionLinkRegex, '{{section "$1"}}');

        // unnamedPassageLinkRegex matches:
        //   open [
        //   any text - the link text
        //   closing ]
        //   no bracket after
        const unnamedPassageLinkRegex = /\[(.*?)\]([^(]|$)/g;

        links = allMatchesForGroup(input, unnamedPassageLinkRegex, 1);
        checkPassageLinks(links, section, passage);

        input = input.replace(unnamedPassageLinkRegex, '{{passage "$1"}}$2');

        return input;
    }

    function allMatchesForGroup(input: string, regex: RegExp, groupNumber: number) {
        const result = [];
        let match;
        while ((match = regex.exec(input))) {
            result.push(match[groupNumber]);
        }
        return result;
    }

    function checkSectionLinks(links: string[], section: Section, passage: Passage | null) {
        const badLinks = links.filter(m => !linkDestinationExists(m, story.sections));
        showBadLinksWarning(badLinks, "section", "[[", "]]", section, passage);
    }

    function checkPassageLinks(links: string[], section: Section, passage: Passage | null) {
        const badLinks = links.filter(m => !linkDestinationExists(m, section.passages));
        showBadLinksWarning(badLinks, "passage", "[", "]", section, passage);
    }

    function linkDestinationExists(link: string, keys: Record<string, any>) {
        // Link destination data may look like:
        //   passageName
        //   passageName, my_attribute=2
        // We're only interested in checking if the named passage or section exists.

        const linkDestination = link.split(",")[0];
        return Object.keys(keys).includes(linkDestination);
    }

    function showBadLinksWarning(badLinks: string[], linkTo: string, before: string, after: string, section: Section, passage: Passage | null) {
        if (!settings.onWarning) return;
        
        for (const badLink of badLinks) {
            let warning: string;
            if (!passage) {
                warning = `${section.filename} line ${section.line}: In section '${section.name}'`;
            }
            else {
                warning = `${section.filename} line ${passage.line}: In section '${section.name}', passage '${passage.name}'`;
            }
            settings.onWarning(`WARNING: ${warning} there is a link to a ${linkTo} called ${before}${badLink}${after}, which doesn't exist`);
        }
    }

    function writeJs(outputJsFile: string[], tabCount: number, js: string[]) {
        const tabs = new Array(tabCount + 1).join("\t");
        outputJsFile.push(`${tabs}(squiffy, get, set) => {`);
        for (const jsLine of js) {
            outputJsFile.push(`${tabs}\t${jsLine}`);
        }
        outputJsFile.push(`${tabs}},`);
    }

    const success = await processFileText(settings.script, settings.scriptBaseFilename, true);

    if (success) {
        if (!Object.keys(story.sections).length) {
            ensureSectionExists(null, true, settings.scriptBaseFilename, 0);
        }
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
                };
            }
        };
    }
    else {
        return {
            success: false,
            errors: errors
        };
    }
}

class Story {
    sections: Record<string, Section> = {};
    title = "";
    scripts: string[] = [];
    stylesheets: string[] = [];
    start = "";
    id: string | null = null;
    uiJs: string[] = [];

    constructor() {
        this.id = crypto.randomUUID();
    }

    addSection(name: string, filename: string | undefined, line: number): Section {
        const section = new Section(name, filename, line);
        this.sections[name] = section;
        return section;
    }

    addUiJs(text: string) {
        this.uiJs.push(text);
    }
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
        const passage = new Passage(name, line);
        this.passages[name] = passage;
        return passage;
    }

    addText(text: string) {
        this.text.push(text);
    }

    addJS(text: string) {
        this.js.push(text);
    }

    addAttribute(text: string) {
        this.attributes.push(text);
    }
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
    }

    addJS(text: string) {
        this.js.push(text);
    }

    addAttribute(text: string) {
        this.attributes.push(text);
    }
}