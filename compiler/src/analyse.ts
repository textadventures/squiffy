import { parse } from "./parse.js";
import type {
    Diagnostic, DiagnosticCode, DiagnosticSeverity, PassageNode, Range, SectionNode, SquiffyFile, StatementNode,
} from "./syntax.js";
import { positionMapper, SourceLine, transformText } from "./text.js";
import { isScriptPath, isSquiffyPath, isStylesheetPath, PROJECT_FILENAME } from "./project.js";
import { findV5Syntax } from "./v5.js";
import { findTemplateError } from "./templates.js";
import { sectionLabels } from "./section-labels.js";
import { attributesSetIn, BUILT_IN_ATTRIBUTES, findAtAttributes, findBuiltInAttributeSets, findUnquotedText } from "./setters.js";

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
    // Carry on after an error instead of stopping, skipping whatever caused it, so that a
    // language service can still report warnings and find sections. The analysis still has
    // success: false, and can't be emitted.
    recover?: boolean;
    // In folder mode (a project with a squiffy.json), the story's other files, in order: its
    // .squiffy files, then its .css and .js files (see getStoryFiles and storyFileList). They're
    // named as getMatchingFilenames would name them. The .squiffy files are processed after the
    // main file, and the stylesheets and scripts are added to the page after any that are
    // @imported, in each case skipping any the story has already @imported. Pass undefined for a
    // story that's just the main file and its @imports.
    storyFiles?: string[];
    // Whether @set and link setters take expressions, with the same rules as {{#if}} (#373).
    // True for a story with a squiffy.json.
    expressions?: boolean;
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
    // The main file, then each .squiffy file in the order it was processed: @imported files where
    // they're imported, then in folder mode the rest of the story's files.
    files: SquiffyFile[];
    diagnostics: Diagnostic[];
    // The story's sections in order, with later sections of the same name replacing earlier ones.
    sections: SectionSymbol[];
    // The section the story starts at: @start's, or else the main file's first section. It may
    // not exist, if @start names a section that doesn't.
    start: string;
    // See AnalyseSettings.expressions
    expressions: boolean;
    // The story's .css and .js files, @imported or in folder mode part of the story, named as
    // getMatchingFilenames names them
    stylesheets: string[];
    scripts: string[];
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
    // @music (#444): the file to play, or null for @music stop. Undefined leaves it as it is.
    music?: string | null;
    // @sound: the files to play once, in order, with "stop" for @sound stop
    sounds: string[] = [];
    // @class (#449): classes on the story's element while the section is the current one
    classes: string[] = [];
    // @transition (#489): how it appears, and how long that takes in milliseconds
    transition?: string;
    transitionTime?: number;
    // @leave: how the old text goes when this clears the screen, and how long that takes
    leave?: string;
    leaveTime?: number;
    // Where @leave is, to say if there's nothing for it to do
    leaveNode?: { filename: string | undefined, range: Range };
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
    // @repeat: its links stay clickable (#104)
    repeat = false;

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

// A @transition time (#489), such as "1s", "0.5s" or "400ms", in milliseconds
function parseTransitionTime(time: string): number | undefined {
    const match = /^(\d+(?:\.\d+)?|\.\d+)(s|ms)$/.exec(time);
    if (!match) return undefined;
    return Math.round(parseFloat(match[1]) * (match[2] == "s" ? 1000 : 1));
}

// Resolves @imports, builds the story's sections and passages, and reports diagnostics.
export async function analyse(settings: AnalyseSettings): Promise<Analysis> {
    const story = new Story();
    const cache = settings.parseCache ?? new ParseCache();
    const files: SquiffyFile[] = [];
    // Each file's text, in the same order as files
    const texts: string[] = [];
    const diagnostics: Diagnostic[] = [];
    const legacyErrors: string[] = [];
    const legacyWarnings: string[] = [];
    let autoSectionCount = 0;
    // The story starts at the main file's first section by default, even if an @import
    // above it has already added sections from other files.
    let mainFirstSection: string | undefined;

    const report = (severity: DiagnosticSeverity, code: DiagnosticCode, filename: string | undefined, range: Range, message: string, legacyLine: number) => {
        diagnostics.push({ file: filename ?? "", range, severity, code, message });
        if (severity == "hint") return;
        const legacy = `${severity.toUpperCase()}: ${filename} line ${legacyLine}: ${message}`;
        (severity == "error" ? legacyErrors : legacyWarnings).push(legacy);
    };

    const storyFiles = settings.storyFiles && new Set(settings.storyFiles);
    // The .squiffy files processed so far, so a story file the main file has already @imported
    // isn't processed again
    const processed = new Set<string | undefined>();
    // Files read by @ui, which in folder mode aren't added to the page as scripts too
    const uiFiles = new Set<string>();
    // The .css and .js files added to the page so far, named as getMatchingFilenames names them
    const stylesheetFiles: string[] = [];
    const scriptFiles: string[] = [];
    // Adds a stylesheet or script to the page. An @import adds it every time, as in Squiffy 6, but
    // folder mode only adds one that isn't there already.
    const addPageFile = (filename: string, externalFiles: ExternalFiles, imported: boolean) => {
        const [names, local] = isStylesheetPath(filename)
            ? [stylesheetFiles, story.stylesheets]
            : [scriptFiles, story.scripts];
        if (names.includes(filename) && !imported) return;
        if (!names.includes(filename)) names.push(filename);
        local.push(externalFiles.getLocalFilename(filename));
    };

    async function processFile(text: string, filename: string | undefined, isFirst: boolean): Promise<boolean> {
        const file = cache.parse(text, filename);
        files.push(file);
        texts.push(text);
        processed.add(filename);
        const lines = text.replace(/\r/g, "").split("\n");

        warnAboutV5Syntax(text, lines, filename);
        if (settings.expressions) {
            for (const found of findAtAttributes(file)) {
                const name = found.text.substring(1);
                report("warning", "squiffy/at-attribute", filename, found.range,
                    `Use ${name} rather than ${found.text}: in a story with a ${PROJECT_FILENAME}, setters name attributes without "@".`,
                    found.range.start.line + 1);
            }
        }

        let section: Section | null = null;
        let passage: Passage | null = null;
        let inUiBlock = false;

        // Where an earlier section or passage was defined, for a duplicate's warning
        const earlierLocation = (earlierFilename: string | undefined, line: number) =>
            earlierFilename == filename || !earlierFilename ? `line ${line}` : `${earlierFilename} line ${line}`;
        const addSection = (name: string, line: number, node: SectionNode | undefined) => {
            if (isFirst && !mainFirstSection) mainFirstSection = name;
            const earlier = hasOwn(story.sections, name) ? story.sections[name] : undefined;
            // The compiler's own names (_default, _continue1, ...) only clash with a section the
            // author named the same way. The main file's preamble can add "_default" more than
            // once, each replacing the last, but that's not a clash the author can see.
            if (earlier && node && !(node.kind == "preamble" && earlier.node?.kind == "preamble")) {
                // A --- in the preamble starts a section that has no node of its own
                const range = node.nameRange ?? node.header?.range
                    ?? { start: { line: line - 1, character: 0 }, end: { line: line - 1, character: lines[line - 1]?.length ?? 0 } };
                report("warning", "squiffy/duplicate-section", filename, range,
                    `There's already a section called [[${name}]], at ${earlierLocation(earlier.filename, earlier.line)}. This one replaces it.`,
                    range.start.line + 1);
            }
            return story.addSection(name, filename, line, node);
        };
        const ensureSectionExists = (line: number) => {
            if (!section && isFirst) {
                return addSection("_default", line, file.preamble);
            }
            return section;
        };
        const addAutoSection = (node: SectionNode, line: number) => {
            autoSectionCount++;
            const autoSectionName = `_continue${autoSectionCount}`;
            section = addSection(autoSectionName, line, node);
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
                    section = addSection(header.name, lineCount, node);
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
            if (hasOwn(section.passages, node.name)) {
                const earlier = section.passages[node.name];
                report("warning", "squiffy/duplicate-passage", filename, node.nameRange,
                    `There's already a passage called [${node.name}] in section '${section.name}', at ${earlierLocation(section.filename, earlier.line)}. This one replaces it.`,
                    lineCount);
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
                        // In folder mode, the file isn't also added to the page as a script, so it
                        // doesn't run twice. Its name is looked up before it's read, as reading it
                        // can leave it out of getMatchingFilenames.
                        if (storyFiles) {
                            for (const match of await settings.externalFiles.getMatchingFilenames(node.path)) uiFiles.add(match);
                        }
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
                case "repeat":
                    if (!passage) {
                        report("warning", "squiffy/repeat-not-in-passage", filename, lineRange(node),
                            "@repeat only works in a passage, so this was ignored.", lineCount);
                    }
                    else {
                        passage.repeat = true;
                    }
                    return true;
                case "end":
                    // Only for the language service's dead end check
                    if (!passage) {
                        section = ensureSectionExists(lineCount);
                        if (!section) return sectionRequired(node);
                    }
                    return true;
                case "title":
                case "start":
                    // In folder mode, a file that isn't the main file could otherwise quietly
                    // change the story's title or where it starts
                    if (storyFiles && !isFirst) {
                        report("warning", "squiffy/not-in-main-file", filename, lineRange(node),
                            `@${node.type} only works in the story's main file, so this was ignored.`, lineCount);
                    }
                    else if (node.type == "title") {
                        story.title = node.value;
                    }
                    else {
                        story.start = node.value;
                    }
                    return true;
                case "import": {
                    if (!settings.externalFiles) {
                        warnExternalFilesUnavailable(`@import ${node.pattern}`, node, filename);
                        return true;
                    }
                    const matches = await settings.externalFiles.getMatchingFilenames(node.pattern);
                    if (storyFiles && matches.length && matches.every(m => storyFiles.has(m))) {
                        report("hint", "squiffy/redundant-import", filename, lineRange(node),
                            `${matches.length == 1 ? "This file is" : "These files are"} already part of the story, as ${PROJECT_FILENAME} includes every .squiffy, .css and .js file in the folder, so this @import isn't needed.`,
                            lineCount);
                    }
                    for (const importFilename of matches) {
                        if (isSquiffyPath(importFilename)) {
                            const content = await settings.externalFiles.getContent(importFilename);
                            const success = await processFile(content, importFilename, false);
                            if (!success && !settings.recover) return false;
                        }
                        else if (isStylesheetPath(importFilename) || isScriptPath(importFilename)) {
                            addPageFile(importFilename, settings.externalFiles, true);
                        }
                    }
                    return true;
                }
                case "sound": {
                    const target = passage ?? (section = ensureSectionExists(lineCount));
                    if (!target) return sectionRequired(node);
                    const value = node.value.trim();
                    if (node.directive == "sound") target.sounds.push(value);
                    else target.music = value == "stop" ? null : value;
                    return true;
                }
                case "class": {
                    const target = passage ?? (section = ensureSectionExists(lineCount));
                    if (!target) return sectionRequired(node);
                    for (const name of node.value.split(/\s+/)) {
                        if (name && !target.classes.includes(name)) target.classes.push(name);
                    }
                    return true;
                }
                case "transition": {
                    const target = passage ?? (section = ensureSectionExists(lineCount));
                    if (!target) return sectionRequired(node);
                    if (!/^[A-Za-z][\w-]*$/.test(node.value)) {
                        report("warning", "squiffy/transition", filename, node.valueRange,
                            `"${node.value}" can't be the name of a transition, so this was ignored. A name is letters, numbers, - and _, starting with a letter.`, lineCount);
                        return true;
                    }
                    let time: number | undefined;
                    if (node.time !== undefined) {
                        time = parseTransitionTime(node.time);
                        if (time === undefined) {
                            report("warning", "squiffy/transition", filename, lineRange(node),
                                `"${node.time}" isn't a time, such as 1s or 400ms, so the transition takes its usual time.`, lineCount);
                        }
                    }
                    if (node.directive == "leave") {
                        target.leave = node.value;
                        target.leaveTime = time;
                        target.leaveNode = { filename, range: lineRange(node) };
                    }
                    else {
                        target.transition = node.value;
                        target.transitionTime = time;
                    }
                    return true;
                }
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
            if (node.header && !handleSectionHeader(node) && !settings.recover) return false;
            for (const statement of node.body) {
                if (!await handleStatement(statement) && !settings.recover) return false;
            }
            for (const passageNode of node.passages) {
                if (!handlePassageHeader(passageNode)) {
                    if (!settings.recover) return false;
                    // Skip the passage, since there's nowhere to put it
                    continue;
                }
                for (const statement of passageNode.body) {
                    if (!await handleStatement(statement) && !settings.recover) return false;
                }
            }
        }

        return true;
    }

    function warnExternalFilesUnavailable(line: string, node: { range: Range }, filename: string | undefined) {
        report("warning", "squiffy/external-files-unavailable", filename, lineRange(node),
            `"${line}" was ignored, as other files can't be loaded here`, node.range.start.line + 1);
    }

    // Text in a setter without quotes, as in Squiffy 6 (#373). A single word is only reported if no
    // attribute of that name is set anywhere in the story, so this needs every file first.
    function warnAboutUnquotedText() {
        const set = new Set<string>();
        files.forEach((file, i) => attributesSetIn(file, texts[i]).forEach(name => set.add(name)));
        for (const file of files) {
            for (const found of findUnquotedText(file, name => set.has(name))) {
                const quoted = found.quoted ?? `"${found.text}"`;
                const message = found.kind == "word"
                    ? `${found.text} isn't set anywhere in the story, so this sets ${found.attribute} to nothing. For the text ${quoted}, use quotes.`
                    : `Text in a setter goes in quotes in a story with a ${PROJECT_FILENAME}: ${quoted}.`;
                report("warning", "squiffy/unquoted-text", file.filename, found.range, message, found.range.start.line + 1);
            }
        }
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

    // Set once the sections are all known, before checking links
    let sectionNames: string[] = [];
    let sectionIndexes = new Map<string, number>();
    // What warnings call sections without names of their own, e.g. 'the "+++Continue..." after "cave"'
    let labels = new Map<string, string>();

    function checkText(container: Section | Passage, section: Section, passage: Passage | null) {
        const getNextSectionName = (): string | null => {
            return sectionNames[(sectionIndexes.get(section.name) ?? -1) + 1] || null;
        };

        const result = transformText(container.text.join("\n"), getNextSectionName, settings.expressions);
        container.output = result.output;

        const toPosition = positionMapper(container.textSources, container.text.map(t => t.length));
        const toRange = (start: number, end: number): Range => ({ start: toPosition(start), end: toPosition(end) });

        const label = labels.get(section.name);
        const inSection = label && section.node?.kind != "named" ? `In ${label}` : `In section '${section.name}'`;
        const where = passage ? `${inSection}, passage '${passage.name}'` : inSection;
        const legacyLine = passage ? passage.line : section.line;
        const warn = (code: DiagnosticCode, start: number, end: number, message: string, line = legacyLine) => {
            report("warning", code, section.filename, toRange(start, end), message, line);
        };

        // Handlebars syntax errors, which would stop the text being shown at all
        const templateError = findTemplateError(result.output);
        if (templateError) {
            const range = toRange(result.mapStart(templateError.start), result.mapEnd(templateError.end));
            report("error", "squiffy/template-syntax", section.filename, range, `${where}, ${templateError.message}`,
                range.start.line + 1);
        }

        for (const missing of result.noNextSection) {
            warn("squiffy/no-next-section", missing.start, missing.end,
                `${inSection}, there is a ${missing.display} link but no following section exists`, section.line);
        }

        // Like the runtime, a passage link can go to one of the master section's passages
        const masterPassages = story.sections[""]?.passages ?? {};

        for (const link of result.links) {
            if (link.form == "next") continue;
            if (link.form == "input") {
                const exists = link.linkType == "section"
                    ? hasOwn(story.sections, link.target)
                    : hasOwn(section.passages, link.target) || hasOwn(masterPassages, link.target);
                if (!exists) {
                    warn(link.linkType == "section" ? "squiffy/unknown-section-link" : "squiffy/unknown-passage-link", link.start, link.end,
                        `${where} there is a text box that goes to a ${link.linkType} called "${link.target}" when Enter is pressed, which doesn't exist`);
                }
            }
            else if (link.linkType == "section") {
                if (!linkDestinationExists(link.target, story.sections)) {
                    warn("squiffy/unknown-section-link", link.start, link.end,
                        `${where} there is a link to a section called [[${link.target}]], which doesn't exist`);
                }
            }
            else if (!linkDestinationExists(link.target, section.passages) && !linkDestinationExists(link.target, masterPassages)) {
                warn("squiffy/unknown-passage-link", link.start, link.end,
                    `${where} there is a link to a passage called [${link.target}], which doesn't exist`);
            }
        }

        // Like the runtime's embed helper, a name can refer to a passage in the
        // current section or the master section, or to any section.
        for (const embed of result.embeds) {
            if (!(embed.name in section.passages) && !(embed.name in story.sections) && !hasOwn(masterPassages, embed.name)) {
                warn("squiffy/unknown-embed", embed.start, embed.end,
                    `${where} there is an embed of {{embed "${embed.name}"}}, but no section or passage with that name exists`);
            }
        }

        // {{goto}} only goes to sections
        for (const goto of result.gotos) {
            if (!goto.name || !(goto.name in story.sections)) {
                const passage = goto.name in section.passages ? ` ({{goto}} can't go to a passage: use {{embed "${goto.name}"}} to show it here)` : "";
                warn("squiffy/unknown-goto", goto.start, goto.end,
                    `${where} there is a {{goto "${goto.name}"}}, but no section with that name exists${passage}`);
            }
        }

        // {{deactivate}} disables links to a passage in this section, or in the master section
        for (const deactivate of result.deactivates) {
            if (!(deactivate.name in section.passages) && !(deactivate.name in masterPassages)) {
                warn("squiffy/unknown-deactivate", deactivate.start, deactivate.end,
                    `${where} there is a {{deactivate "${deactivate.name}"}}, but no passage with that name exists in this section`);
            }
        }
    }

    // With recover, processFile carries on after errors, so check for them too
    let success = await processFile(settings.script, settings.scriptBaseFilename, true);

    // In folder mode, the rest of the story's files, in order
    for (const storyFile of settings.storyFiles ?? []) {
        if (!success && !settings.recover) break;
        if (processed.has(storyFile)) continue;
        if (!settings.externalFiles) {
            report("warning", "squiffy/external-files-unavailable", settings.scriptBaseFilename,
                { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                "The story's other files were ignored, as other files can't be loaded here", 1);
            break;
        }
        if (!isSquiffyPath(storyFile)) {
            if (!uiFiles.has(storyFile)) addPageFile(storyFile, settings.externalFiles, false);
            continue;
        }
        const content = await settings.externalFiles.getContent(storyFile);
        success = await processFile(content, storyFile, false) && success;
    }
    success &&= !legacyErrors.length;

    if (success || settings.recover) {
        if (!Object.keys(story.sections).length) {
            story.addSection("_default", settings.scriptBaseFilename, 0, undefined);
        }
        if (!story.start) {
            story.start = mainFirstSection ?? Object.keys(story.sections)[0];
        }
        sectionNames = Object.keys(story.sections);
        sectionIndexes = new Map(sectionNames.map((name, i) => [name, i]));
        const nodeNames = new Map(Object.values(story.sections).flatMap(section => section.node ? [[section.node, section.name] as const] : []));
        labels = sectionLabels(files, node => nodeNames.get(node));
        for (const section of Object.values(story.sections)) {
            checkText(section, section, null);
            for (const passage of Object.values(section.passages)) {
                checkText(passage, section, passage);
            }
        }
        success &&= !legacyErrors.length;
    }

    if (settings.expressions) {
        warnAboutUnquotedText();
    }

    // A story setting an attribute that Squiffy sets itself, such as turns (#377)
    files.forEach((file, i) => {
        for (const found of findBuiltInAttributeSets(file, texts[i])) {
            report("warning", "squiffy/built-in-attribute", file.filename, found.range,
                `Squiffy sets ${found.name} itself: it's ${BUILT_IN_ATTRIBUTES.get(found.name)}. Use a different name for your own attribute.`,
                found.range.start.line + 1);
        }
    });

    // @leave only does something when the screen is cleared: by the section or passage it's in, or by
    // one that it's for, as the master section's @leave is for every section
    const master = story.sections[""];
    const clears = (s: Section) => s.clear || Object.values(s.passages).some(p => p.clear);
    const anyClear = Object.values(story.sections).some(clears);
    const checkLeave = (target: TextContainer, used: boolean) => {
        if (!target.leaveNode || target.leave == "none" || used) return;
        report("warning", "squiffy/transition", target.leaveNode.filename, target.leaveNode.range,
            "@leave is for when the screen is cleared, but nothing it's for has @clear, so it does nothing.",
            target.leaveNode.range.start.line + 1);
    };
    for (const section of Object.values(story.sections)) {
        const masterPassageClears = !!(section.passages[""]?.clear || master?.passages[""]?.clear);
        checkLeave(section, section === master ? anyClear : clears(section) || !!master?.clear || (master ? Object.values(master.passages).some(p => p.clear) : false));
        for (const passage of Object.values(section.passages)) {
            checkLeave(passage, passage.clear || masterPassageClears || (passage.name == "" && clears(section)));
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
        start: story.start,
        expressions: settings.expressions ?? false,
        stylesheets: stylesheetFiles,
        scripts: scriptFiles,
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
    if (hasOwn(keys, trimmedLink)) {
        return true;
    }
    // Otherwise, assume a comma separates the destination from setters.
    const linkDestination = trimmedLink.split(",")[0].trim();
    return hasOwn(keys, linkDestination);
}

// The same as Object.keys(keys).includes(key) for the plain objects used here, without building
// an array for every link.
function hasOwn(keys: Record<string, unknown>, key: string) {
    return Object.prototype.hasOwnProperty.call(keys, key);
}
