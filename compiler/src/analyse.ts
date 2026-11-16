import { parse } from "./parse.js";
import type {
    Diagnostic, DiagnosticCode, DiagnosticSeverity, PassageNode, Range, SectionNode, SquiffyFile, StatementNode,
} from "./syntax.js";
import { positionMapper, SourceLine, transformText } from "./text.js";
import { findV5Syntax } from "./v5.js";

export interface ExternalFiles {
    getMatchingFilenames(pattern: string): Promise<string[]>;
    getContent(filename: string): Promise<string>;
    getLocalFilename(filename: string): string;
}

export interface AnalyseSettings {
    scriptBaseFilename?: string;
    script: string;
    externalFiles?: ExternalFiles;
    // Reuses the syntax trees of files that haven't changed since the last analysis.
    parseCache?: ParseCache;
}

// Caches the syntax tree of each file by filename, reparsing a file only when its text changes.
export class ParseCache {
    private files = new Map<string, { text: string; file: SquiffyFile }>();

    parse(text: string, filename?: string): SquiffyFile {
        const key = filename ?? "";
        const cached = this.files.get(key);
        if (cached && cached.text === text) {
            return cached.file;
        }
        const file = parse(text, filename);
        this.files.set(key, { text, file });
        return file;
    }
}

export interface SectionSymbol {
    name: string;
    // The file the section is in, as in Diagnostic.file
    file: string;
    // The section in the syntax tree. For "_default", this is the main file's preamble.
    // Missing only for the empty "_default" section of a story with no content.
    node?: SectionNode;
    passages: PassageSymbol[];
}

export interface PassageSymbol {
    name: string;
    node: PassageNode;
}

export interface Analysis {
    // False if there's an error diagnostic. Analysis stops at the first error.
    success: boolean;
    // The main file, then each imported .squiffy file in the order it was imported.
    files: SquiffyFile[];
    diagnostics: Diagnostic[];
    // The story's sections in order, with later sections of the same name replacing earlier ones.
    sections: SectionSymbol[];
}

// ---- Story model, which emit() turns into output ----

export class Story {
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

    addSection(name: string, filename: string | undefined, line: number, node: SectionNode | undefined): Section {
        const section = new Section(name, filename, line, node);
        this.sections[name] = section;
        return section;
    }
}

class TextContainer {
    text: string[] = [];
    textSources: SourceLine[] = [];
    js: string[] = [];
    clear = false;
    attributes: string[] = [];
    // The text after links have been converted
    output = "";

    addText(text: string, source: SourceLine) {
        this.text.push(text);
        this.textSources.push(source);
    }
}

export class Section extends TextContainer {
    passages: Record<string, Passage> = {};

    constructor(public name: string, public filename: string | undefined, public line: number, public node: SectionNode | undefined) {
        super();
    }

    addPassage(name: string, line: number, node: PassageNode) {
        const passage = new Passage(name, line, node);
        this.passages[name] = passage;
        return passage;
    }
}

export class Passage extends TextContainer {
    constructor(public name: string, public line: number, public node: PassageNode) {
        super();
    }
}

// What emit() and compile() need that isn't part of the public Analysis.
export interface AnalysisInternals {
    story: Story;
    // Errors and warnings formatted as the compiler always has, for CompileError.errors and
    // onWarning. These give the line of the section or passage for link problems, where
    // diagnostics give the line of the link.
    legacyErrors: string[];
    legacyWarnings: string[];
}

export const analysisInternals = new WeakMap<Analysis, AnalysisInternals>();

const lineRange = (node: { range: Range }): Range => node.range;

// Resolves @imports, builds the story's sections and passages, and reports diagnostics.
export async function analyse(settings: AnalyseSettings): Promise<Analysis> {
    const story = new Story();
    const cache = settings.parseCache ?? new ParseCache();
    const files: SquiffyFile[] = [];
    const diagnostics: Diagnostic[] = [];
    const legacyErrors: string[] = [];
    const legacyWarnings: string[] = [];
    let autoSectionCount = 0;

    const report = (severity: DiagnosticSeverity, code: DiagnosticCode, filename: string | undefined, range: Range, message: string, legacyLine: number) => {
        diagnostics.push({ file: filename ?? "", range, severity, code, message });
        const legacy = `${severity.toUpperCase()}: ${filename} line ${legacyLine}: ${message}`;
        (severity == "error" ? legacyErrors : legacyWarnings).push(legacy);
    };

    async function processFile(text: string, filename: string | undefined, isFirst: boolean): Promise<boolean> {
        const file = cache.parse(text, filename);
        files.push(file);
        const lines = text.replace(/\r/g, "").split("\n");

        warnAboutV5Syntax(text, lines, filename);

        let section: Section | null = null;
        let passage: Passage | null = null;
        let inUiBlock = false;

        const ensureSectionExists = (line: number) => {
            if (!section && isFirst) {
                return story.addSection("_default", filename, line, file.preamble);
            }
            return section;
        };
        const addAutoSection = (node: SectionNode, line: number) => {
            autoSectionCount++;
            const autoSectionName = `_continue${autoSectionCount}`;
            section = story.addSection(autoSectionName, filename, line, node);
            passage = null;
            return autoSectionName;
        };
        const sectionRequired = (node: { range: Range }) => {
            report("error", "squiffy/content-before-section", filename, lineRange(node),
                "This needs to be in a section, but it comes before the first section in this file.", node.range.start.line + 1);
            return false;
        };
        const source = (node: { range: Range }): SourceLine => ({ line: node.range.start.line, length: lines[node.range.start.line].length });

        const handleSectionHeader = (node: SectionNode): boolean => {
            const header = node.header!;
            const lineCount = header.range.start.line + 1;
            switch (header.type) {
                case "section-header":
                    section = story.addSection(header.name, filename, lineCount, node);
                    passage = null;
                    return true;
                case "continue": {
                    const previousSection = ensureSectionExists(lineCount);
                    if (!previousSection) return sectionRequired(header);
                    const autoSectionName = addAutoSection(node, lineCount);
                    previousSection.addText(`[[${header.text || "Continue..."}]](${autoSectionName})`, source(header));
                    return true;
                }
                case "separator":
                    return handleSeparator(node, lineCount);
            }
        };

        const handleSeparator = (node: SectionNode | null, lineCount: number) => {
            inUiBlock = false;
            if (!section) {
                // Just add the _default section if we haven't started yet
                ensureSectionExists(lineCount);
            }
            else {
                addAutoSection(node ?? file.preamble, lineCount);
            }
            return true;
        };

        const handlePassageHeader = (node: PassageNode): boolean => {
            const lineCount = node.header.range.start.line + 1;
            if (!section) {
                report("error", "squiffy/passage-without-section", filename, node.nameRange,
                    `Can't add passage "${node.name}" as no section has been created.`, lineCount);
                return false;
            }
            passage = section.addPassage(node.name, lineCount, node);
            return true;
        };

        const handleStatement = async (node: StatementNode): Promise<boolean> => {
            const lineCount = node.range.start.line + 1;
            switch (node.type) {
                case "separator":
                    return handleSeparator(null, lineCount);
                case "ui-block-start":
                    inUiBlock = true;
                    return true;
                case "ui-file":
                    if (settings.externalFiles) {
                        story.uiJs.push(await settings.externalFiles.getContent(node.path));
                    }
                    else {
                        warnExternalFilesUnavailable(`@ui ${node.path}`, node, filename);
                    }
                    return true;
                case "clear":
                    if (!passage) {
                        section = ensureSectionExists(lineCount);
                        if (!section) return sectionRequired(node);
                        section.clear = true;
                    }
                    else {
                        passage.clear = true;
                    }
                    return true;
                case "title":
                    story.title = node.value;
                    return true;
                case "start":
                    story.start = node.value;
                    return true;
                case "import":
                    if (!settings.externalFiles) {
                        warnExternalFilesUnavailable(`@import ${node.pattern}`, node, filename);
                        return true;
                    }
                    for (const importFilename of await settings.externalFiles.getMatchingFilenames(node.pattern)) {
                        if (importFilename.endsWith(".squiffy")) {
                            const content = await settings.externalFiles.getContent(importFilename);
                            const success = await processFile(content, importFilename, false);
                            if (!success) return false;
                        }
                        else if (importFilename.endsWith(".js")) {
                            story.scripts.push(settings.externalFiles.getLocalFilename(importFilename));
                        }
                        else if (importFilename.endsWith(".css")) {
                            story.stylesheets.push(settings.externalFiles.getLocalFilename(importFilename));
                        }
                    }
                    return true;
                case "attribute": {
                    section = ensureSectionExists(lineCount);
                    let attribute: string;
                    switch (node.directive) {
                        case "set": attribute = node.value; break;
                        case "unset": attribute = "not " + node.value; break;
                        case "inc": attribute = node.value + "+=" + (node.amount ?? "1"); break;
                        case "dec": attribute = node.value + "-=" + (node.amount ?? "1"); break;
                    }
                    if (passage) {
                        passage.attributes.push(attribute);
                    }
                    else {
                        if (!section) return sectionRequired(node);
                        section.attributes.push(attribute);
                    }
                    return true;
                }
                case "js":
                    if (inUiBlock) {
                        story.uiJs.push(node.code);
                    }
                    else if (!passage) {
                        section = ensureSectionExists(lineCount);
                        if (!section) return sectionRequired(node);
                        section.js.push(node.code);
                    }
                    else {
                        passage.js.push(node.code);
                    }
                    return true;
                case "text":
                    if (inUiBlock) {
                        report("error", "squiffy/text-in-ui-block", filename, lineRange(node), "Unexpected text in @ui block.", lineCount);
                        return false;
                    }
                    else if (!passage) {
                        section = ensureSectionExists(lineCount);
                        // In an imported file, text before the first section is ignored
                        section?.addText(node.text, source(node));
                    }
                    else {
                        passage.addText(node.text, source(node));
                    }
                    return true;
            }
        };

        for (const node of [file.preamble, ...file.sections]) {
            if (node.type == "snippet") {
                section = null;
                passage = null;
                continue;
            }
            if (node.header && !handleSectionHeader(node)) return false;
            for (const statement of node.body) {
                if (!await handleStatement(statement)) return false;
            }
            for (const passageNode of node.passages) {
                if (!handlePassageHeader(passageNode)) return false;
                for (const statement of passageNode.body) {
                    if (!await handleStatement(statement)) return false;
                }
            }
        }

        return true;
    }

    function warnExternalFilesUnavailable(line: string, node: { range: Range }, filename: string | undefined) {
        report("warning", "squiffy/external-files-unavailable", filename, lineRange(node),
            `"${line}" was ignored, as other files can't be loaded here`, node.range.start.line + 1);
    }

    function warnAboutV5Syntax(text: string, lines: string[], filename: string | undefined) {
        const truncate = (s: string) => s.length > 60 ? s.substring(0, 57) + "..." : s;

        for (const match of findV5Syntax(text)) {
            let message = `${truncate(match.text)} looks like Squiffy 5 text processor syntax, which isn't supported in Squiffy 6.`;
            if (match.suggestion) {
                message += match.suggestion.length > 60
                    ? " Convert it to Handlebars syntax."
                    : ` Use ${match.suggestion} instead.`;
            }
            else if (match.text.startsWith("{else:")) {
                message += " Use {{else}} inside an {{#if}} block instead.";
            }
            const line = match.line - 1;
            const lineText = lines[line] ?? "";
            const found = lineText.indexOf(match.text.split("\n")[0]);
            const start = Math.max(found, 0);
            const end = found >= 0 ? Math.min(found + match.text.length, lineText.length) : lineText.length;
            report("warning", "squiffy/v5-syntax", filename,
                { start: { line, character: start }, end: { line, character: end } }, message, match.line);
        }
    }

    function checkText(container: Section | Passage, section: Section, passage: Passage | null) {
        const getNextSectionName = (): string | null => {
            const sectionNames = Object.keys(story.sections);
            const currentIndex = sectionNames.indexOf(section.name);
            return sectionNames[currentIndex + 1] || null;
        };

        const result = transformText(container.text.join("\n"), getNextSectionName);
        container.output = result.output;

        const toPosition = positionMapper(container.textSources, container.text.map(t => t.length));
        const toRange = (start: number, end: number): Range => ({ start: toPosition(start), end: toPosition(end) });

        const where = passage
            ? `In section '${section.name}', passage '${passage.name}'`
            : `In section '${section.name}'`;
        const legacyLine = passage ? passage.line : section.line;
        const warn = (code: DiagnosticCode, start: number, end: number, message: string, line = legacyLine) => {
            report("warning", code, section.filename, toRange(start, end), message, line);
        };

        for (const missing of result.noNextSection) {
            warn("squiffy/no-next-section", missing.start, missing.end,
                `In section '${section.name}', there is a ${missing.display} link but no following section exists`, section.line);
        }

        for (const link of result.links) {
            if (link.form == "next") continue;
            if (link.linkType == "section") {
                if (!linkDestinationExists(link.target, story.sections)) {
                    warn("squiffy/unknown-section-link", link.start, link.end,
                        `${where} there is a link to a section called [[${link.target}]], which doesn't exist`);
                }
            }
            else if (!linkDestinationExists(link.target, section.passages)) {
                warn("squiffy/unknown-passage-link", link.start, link.end,
                    `${where} there is a link to a passage called [${link.target}], which doesn't exist`);
            }
        }

        // Like the runtime's embed helper, a name can refer to a passage in the
        // current section or to any section.
        for (const embed of result.embeds) {
            if (!(embed.name in section.passages) && !(embed.name in story.sections)) {
                warn("squiffy/unknown-embed", embed.start, embed.end,
                    `${where} there is an embed of {{embed "${embed.name}"}}, but no section or passage with that name exists`);
            }
        }
    }

    const success = await processFile(settings.script, settings.scriptBaseFilename, true);

    if (success) {
        if (!Object.keys(story.sections).length) {
            story.addSection("_default", settings.scriptBaseFilename, 0, undefined);
        }
        if (!story.start) {
            story.start = Object.keys(story.sections)[0];
        }
        for (const section of Object.values(story.sections)) {
            checkText(section, section, null);
            for (const passage of Object.values(section.passages)) {
                checkText(passage, section, passage);
            }
        }
    }

    const analysis: Analysis = {
        success,
        files,
        diagnostics,
        sections: Object.values(story.sections).map(section => ({
            name: section.name,
            file: section.filename ?? "",
            ...(section.node ? { node: section.node } : {}),
            passages: Object.values(section.passages).map(passage => ({ name: passage.name, node: passage.node })),
        })),
    };
    analysisInternals.set(analysis, { story, legacyErrors, legacyWarnings });
    return analysis;
}

function linkDestinationExists(link: string, keys: Record<string, unknown>) {
    // Link destination data may look like:
    //   passageName
    //   passageName, my_attribute=2
    //   passage name with a comma, in the name
    // We're only interested in checking if the named passage or section exists.

    // First check if the full link is a valid destination (handles names containing commas).
    const trimmedLink = link.trim();
    if (Object.keys(keys).includes(trimmedLink)) {
        return true;
    }
    // Otherwise, assume a comma separates the destination from setters.
    const linkDestination = trimmedLink.split(",")[0].trim();
    return Object.keys(keys).includes(linkDestination);
}
