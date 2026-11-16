// The Squiffy language service: outline, diagnostics, go to definition, references, rename,
// completion, hover, folding, quick fixes and "which section is this", for a multi-file project.
// It has no UI or DOM dependencies, so the web editor, the desktop app (from a Web Worker) and an
// LSP adapter for VS Code can all call it directly.
//
// Positions and ranges are zero-based { line, character }, following LSP conventions.

import { analyse, Analysis, ExternalFiles, ParseCache } from "./analyse.js";
import type {
    Diagnostic, EmbedNode, LinkNode, PassageNode, Position, Range, SectionNode, SnippetNode, SquiffyFile,
} from "./syntax.js";
import { convertV5Syntax, findV5Syntax } from "./v5.js";

export type { Diagnostic, Position, Range } from "./syntax.js";

// Read access to the project. A ProjectFileSystem from @textadventures/project-fs fits as is.
export interface ProjectFiles {
    // Every file in the project, as project paths: relative, with "/" separators.
    list(): Promise<{ path: string }[]>;
    readText(path: string): Promise<string>;
}

export interface LanguageServiceOptions {
    files: ProjectFiles;
    // The project path of the story's main .squiffy file, which @imports the others.
    mainFile: string;
}

export interface TextEdit {
    range: Range;
    newText: string;
}

// Edits to make, by project path
export type WorkspaceEdit = Record<string, TextEdit[]>;

export interface Location {
    file: string;
    range: Range;
}

export interface DocumentSymbol {
    name: string;
    kind: "title" | "section" | "passage" | "snippet";
    // For sections without a name of their own (+++ and --- lines), what the line says.
    detail?: string;
    range: Range;
    // The range to select when the symbol is picked, e.g. the name in its header.
    selectionRange: Range;
    children: DocumentSymbol[];
}

export interface CompletionItem {
    label: string;
    kind: "section" | "passage" | "attribute" | "snippet";
    // The text to insert, if it isn't the label.
    insertText?: string;
    detail?: string;
    // The text the item replaces: what has been typed of it so far.
    range: Range;
}

export interface Hover {
    // Markdown
    contents: string;
    range: Range;
}

export interface FoldingRange {
    startLine: number;
    endLine: number;
}

export interface CodeAction {
    title: string;
    kind: "quickfix";
    // The diagnostic this fixes, if any
    diagnostic?: Diagnostic;
    edit: WorkspaceEdit;
}

export interface SectionAt {
    // The section's name in the story, including names given to unnamed sections, such as
    // "_default" and "_continue1".
    section: string;
    passage?: string;
}

export type RenameResult = { edit: WorkspaceEdit } | { error: string };

export interface LanguageService {
    // Sets the text of a file that's open in an editor, which takes precedence over what's in
    // the project. Pass undefined when it's closed, to go back to reading the project.
    updateFile(path: string, text: string | undefined): void;
    // Tells the service a file changed in the project (or was added or deleted), e.g. from a
    // file watcher.
    fileChanged(path: string): void;
    setMainFile(path: string): void;

    // The analysis of the whole project, from the main file. Recomputed after a change, reusing
    // the syntax trees of unchanged files.
    getAnalysis(): Promise<Analysis>;
    getDiagnostics(path: string): Promise<Diagnostic[]>;
    getDocumentSymbols(path: string): Promise<DocumentSymbol[]>;
    getDefinition(path: string, position: Position): Promise<Location | undefined>;
    getReferences(path: string, position: Position, includeDeclaration?: boolean): Promise<Location[]>;
    getRenameEdits(path: string, position: Position, newName: string): Promise<RenameResult | undefined>;
    getCompletions(path: string, position: Position): Promise<CompletionItem[]>;
    getHover(path: string, position: Position): Promise<Hover | undefined>;
    getFoldingRanges(path: string): Promise<FoldingRange[]>;
    getCodeActions(path: string, range: Range): Promise<CodeAction[]>;
    getSectionAt(path: string, position: Position): Promise<SectionAt | undefined>;
}

// ---- What a position refers to ----

type SymbolRef =
    | { kind: "section"; name: string }
    | { kind: "passage"; section: string; name: string };

const sameSymbol = (a: SymbolRef, b: SymbolRef) =>
    a.kind == b.kind && a.name == b.name && (a.kind == "section" || a.section == (b as typeof a).section);

// A link or embed, with where it is
interface Usage {
    file: string;
    container: SectionNode | PassageNode;
    // The section the container is in
    sectionNode: SectionNode;
    link?: LinkNode;
    embed?: EmbedNode;
}

// The analysis, indexed for lookups
interface Index {
    analysis: Analysis;
    files: Map<string, SquiffyFile>;
    texts: Map<string, string>;
    sectionNames: string[];
    // Story section name -> where it's defined
    sections: Map<string, { file: string; node?: SectionNode; passages: Map<string, PassageNode> }>;
    // Tree section -> its name in the story. Missing for sections replaced by a later one of the
    // same name, and for files that aren't part of the story.
    nodeNames: Map<SectionNode, string>;
    usages: Usage[];
    attributes: Set<string>;
    snippets: { file: string; node: SnippetNode }[];
}

const contains = (range: Range, pos: Position) =>
    comparePositions(range.start, pos) <= 0 && comparePositions(pos, range.end) <= 0;

function comparePositions(a: Position, b: Position) {
    return a.line - b.line || a.character - b.character;
}

const overlaps = (a: Range, b: Range) =>
    comparePositions(a.start, b.end) <= 0 && comparePositions(b.start, a.end) <= 0;

// Same as the compiler: the whole target if it's a name, otherwise the part before the first comma.
function resolveName(target: string, has: (name: string) => boolean): string | undefined {
    const trimmed = target.trim();
    if (has(trimmed)) return trimmed;
    const destination = trimmed.split(",")[0].trim();
    return has(destination) ? destination : undefined;
}

// The name a broken link was trying to reach
const intendedName = (target: string) => target.trim().split(",")[0].trim();

function attributeName(expression: string) {
    return expression.replace(/^\s*not\s+/, "").split(/[-+]?=/)[0].trim();
}

function resolvePath(baseDir: string, relative: string): string | null {
    const parts = baseDir ? baseDir.split("/") : [];
    for (const part of relative.split("/")) {
        if (part == "" || part == ".") continue;
        if (part == "..") {
            if (!parts.length) return null;
            parts.pop();
        }
        else {
            parts.push(part);
        }
    }
    return parts.join("/");
}

const dirname = (path: string) => path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";

function relativePath(fromDir: string, path: string): string {
    const from = fromDir ? fromDir.split("/") : [];
    const to = path.split("/");
    let common = 0;
    while (common < from.length && common < to.length - 1 && from[common] == to[common]) common++;
    return [...from.slice(common).map(() => ".."), ...to.slice(common)].join("/");
}

// "*" and "?" match within one path segment; "**" matches across segments.
function globToRegExp(pattern: string): RegExp {
    let out = "";
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (c == "*") {
            if (pattern[i + 1] == "*") {
                i++;
                if (pattern[i + 1] == "/") {
                    i++;
                    out += "(?:.*/)?";
                }
                else {
                    out += ".*";
                }
            }
            else {
                out += "[^/]*";
            }
        }
        else if (c == "?") {
            out += "[^/]";
        }
        else {
            out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        }
    }
    return new RegExp(`^${out}$`);
}

const endOfText = (text: string): Position => {
    const lines = text.split("\n");
    return { line: lines.length - 1, character: lines[lines.length - 1].length };
};

const lineRange = (line: number, start: number, end: number): Range => ({
    start: { line, character: start },
    end: { line, character: end },
});

export function createLanguageService(options: LanguageServiceOptions): LanguageService {
    const files = options.files;
    let mainFile = options.mainFile;
    const openFiles = new Map<string, string>();
    const diskTexts = new Map<string, Promise<string>>();
    const parseCache = new ParseCache();
    let version = 0;
    let cached: { version: number; index: Promise<Index> } | undefined;

    const changed = () => { version++; };

    async function readFile(path: string): Promise<string> {
        const open = openFiles.get(path);
        if (open !== undefined) return open;
        let text = diskTexts.get(path);
        if (!text) {
            text = files.readText(path);
            diskTexts.set(path, text);
            // Don't cache a failed read
            text.catch(() => diskTexts.delete(path));
        }
        return text;
    }

    // The compiler's ExternalFiles, resolving @import patterns and @ui paths against the main
    // file's folder and never importing a file twice, as the CLI does.
    function externalFiles(texts: Map<string, string>): ExternalFiles {
        const baseDir = dirname(mainFile);
        const included = new Set([mainFile]);
        const matched = new Set<string>();
        return {
            async getMatchingFilenames(pattern: string) {
                const resolved = resolvePath(baseDir, pattern);
                if (resolved === null) return [];
                const regex = globToRegExp(resolved);
                const paths = new Set((await files.list()).map(f => f.path));
                for (const open of openFiles.keys()) paths.add(open);
                const result = [...paths].filter(p => regex.test(p) && !included.has(p)).sort();
                for (const p of result) matched.add(p);
                return result;
            },
            async getContent(filename: string) {
                const path = matched.has(filename) ? filename : resolvePath(baseDir, filename);
                if (path === null) return "";
                included.add(path);
                try {
                    const text = await readFile(path);
                    texts.set(path, text);
                    return text;
                }
                catch {
                    return "";
                }
            },
            getLocalFilename: (filename: string) => relativePath(baseDir, filename),
        };
    }

    async function buildIndex(): Promise<Index> {
        const texts = new Map<string, string>();
        let script = "";
        try {
            script = await readFile(mainFile);
        }
        catch {
            // A missing main file analyses as an empty story
        }
        texts.set(mainFile, script);

        const analysis = await analyse({
            script,
            scriptBaseFilename: mainFile,
            externalFiles: externalFiles(texts),
            parseCache,
            recover: true,
        });

        const index: Index = {
            analysis,
            files: new Map(),
            texts,
            sectionNames: analysis.sections.map(s => s.name),
            sections: new Map(),
            nodeNames: new Map(),
            usages: [],
            attributes: new Set(),
            snippets: [],
        };

        for (const file of analysis.files) {
            if (file.filename !== undefined && !index.files.has(file.filename)) {
                index.files.set(file.filename, file);
            }
        }
        for (const section of analysis.sections) {
            index.sections.set(section.name, {
                file: section.file,
                node: section.node,
                passages: new Map(section.passages.map(p => [p.name, p.node])),
            });
            if (section.node) index.nodeNames.set(section.node, section.name);
        }

        for (const [path, file] of index.files) {
            for (const node of [file.preamble, ...file.sections]) {
                if (node.type == "snippet") {
                    index.snippets.push({ file: path, node });
                    continue;
                }
                for (const container of [node, ...node.passages]) {
                    for (const link of container.links) {
                        index.usages.push({ file: path, container, sectionNode: node, link });
                        const setters = link.target.split(",").slice(1);
                        for (const setter of setters) {
                            const name = attributeName(setter);
                            if (name) index.attributes.add(name);
                        }
                    }
                    for (const embed of container.embeds) {
                        index.usages.push({ file: path, container, sectionNode: node, embed });
                    }
                    for (const statement of container.body) {
                        if (statement.type == "attribute") {
                            const name = attributeName(statement.value);
                            if (name) index.attributes.add(name);
                        }
                        else if (statement.type == "js") {
                            for (const match of statement.code.matchAll(/\bset\(\s*["']([^"']+)["']/g)) {
                                index.attributes.add(match[1]);
                            }
                        }
                    }
                }
            }
        }

        return index;
    }

    function getIndex(): Promise<Index> {
        if (!cached || cached.version != version) {
            cached = { version, index: buildIndex() };
        }
        return cached.index;
    }

    // The syntax tree of a file, whether or not it's part of the story
    async function getFile(index: Index, path: string): Promise<{ file: SquiffyFile; text: string } | undefined> {
        const file = index.files.get(path);
        if (file) return { file, text: index.texts.get(path) ?? "" };
        try {
            const text = await readFile(path);
            return { file: parseCache.parse(text, path), text };
        }
        catch {
            return undefined;
        }
    }

    // The passages a passage link or embed in this section can reach
    function passagesOf(index: Index, sectionNode: SectionNode) {
        const name = index.nodeNames.get(sectionNode);
        return name === undefined ? undefined : index.sections.get(name)?.passages;
    }

    function resolveUsage(index: Index, usage: Usage): SymbolRef | undefined {
        const sectionName = index.nodeNames.get(usage.sectionNode);
        if (usage.embed) {
            const name = usage.embed.name;
            const passages = passagesOf(index, usage.sectionNode);
            if (sectionName !== undefined && passages?.has(name)) return { kind: "passage", section: sectionName, name };
            if (index.sections.has(name)) return { kind: "section", name };
            return undefined;
        }
        const link = usage.link!;
        if (link.linkType == "section") {
            if (link.form == "next") {
                if (sectionName === undefined) return undefined;
                const next = index.sectionNames[index.sectionNames.indexOf(sectionName) + 1];
                return next === undefined ? undefined : { kind: "section", name: next };
            }
            const name = resolveName(link.target, n => index.sections.has(n));
            return name === undefined ? undefined : { kind: "section", name };
        }
        const passages = passagesOf(index, usage.sectionNode);
        if (sectionName === undefined || !passages) return undefined;
        const name = resolveName(link.target, n => passages.has(n));
        return name === undefined ? undefined : { kind: "passage", section: sectionName, name };
    }

    // Where a symbol is defined: the name in its header.
    function definitionOf(index: Index, symbol: SymbolRef): Location | undefined {
        if (symbol.kind == "section") {
            const section = index.sections.get(symbol.name);
            if (!section?.node) return undefined;
            const range = section.node.nameRange ?? section.node.header?.range ?? section.node.range;
            return { file: section.file, range };
        }
        const section = index.sections.get(symbol.section);
        const passage = section?.passages.get(symbol.name);
        if (!section || !passage) return undefined;
        return { file: section.file, range: passage.nameRange };
    }

    // What's at a position: a link, an embed, or the name in a section or passage header.
    async function symbolAt(index: Index, path: string, position: Position): Promise<{ symbol: SymbolRef; range: Range; usage?: Usage } | undefined> {
        for (const usage of index.usages) {
            if (usage.file != path) continue;
            const range = usage.link?.range ?? usage.embed!.range;
            if (!contains(range, position)) continue;
            const symbol = resolveUsage(index, usage);
            return symbol ? { symbol, range, usage } : undefined;
        }
        const tree = await getFile(index, path);
        if (!tree) return undefined;
        for (const node of tree.file.sections) {
            if (node.type != "section") continue;
            if (node.nameRange && contains(node.nameRange, position)) {
                const name = index.nodeNames.get(node);
                return name === undefined ? undefined : { symbol: { kind: "section", name }, range: node.nameRange };
            }
        }
        for (const node of [tree.file.preamble, ...tree.file.sections]) {
            if (node.type != "section") continue;
            for (const passage of node.passages) {
                if (contains(passage.nameRange, position)) {
                    const section = index.nodeNames.get(node);
                    return section === undefined ? undefined : { symbol: { kind: "passage", section, name: passage.name }, range: passage.nameRange };
                }
            }
        }
        return undefined;
    }

    // The range of the name within a link's target, for rename. Undefined if it can't be found
    // exactly, e.g. a target that spans lines.
    function nameRangeInLink(index: Index, usage: Usage, name: string): Range | undefined {
        if (usage.embed) return usage.embed.nameRange;
        const link = usage.link!;
        if (link.form == "next") return undefined;
        const range = link.targetRange;
        if (range.start.line != range.end.line) return undefined;
        const offset = link.target.length - link.target.trimStart().length;
        const start = range.start.character + offset;
        const line = (index.texts.get(usage.file) ?? "").split("\n")[range.start.line] ?? "";
        if (line.substring(start, start + name.length) != name) return undefined;
        return lineRange(range.start.line, start, start + name.length);
    }

    function referencesTo(index: Index, symbol: SymbolRef, includeDeclaration: boolean): Location[] {
        const result: Location[] = [];
        if (includeDeclaration) {
            const definition = definitionOf(index, symbol);
            if (definition) result.push(definition);
        }
        for (const usage of index.usages) {
            const target = resolveUsage(index, usage);
            if (target && sameSymbol(target, symbol)) {
                result.push({ file: usage.file, range: usage.link?.range ?? usage.embed!.range });
            }
        }
        return result;
    }

    function addEdit(edit: WorkspaceEdit, file: string, textEdit: TextEdit) {
        (edit[file] ??= []).push(textEdit);
    }

    // The section and passage containing a position in a file
    function containerAt(file: SquiffyFile, position: Position): { section?: SectionNode; snippet?: SnippetNode; passage?: PassageNode } {
        let current: SectionNode | SnippetNode = file.preamble;
        for (const node of file.sections) {
            if (node.range.start.line <= position.line) current = node;
        }
        if (current.type == "snippet") return { snippet: current };
        let passage: PassageNode | undefined;
        for (const p of current.passages) {
            if (p.range.start.line <= position.line) passage = p;
        }
        return { section: current, passage };
    }

    function firstLines(node: SectionNode | PassageNode, count: number) {
        return node.body.filter(n => n.type == "text").map(n => n.text).join("\n").trim().split("\n").slice(0, count).join("\n");
    }

    return {
        updateFile(path, text) {
            if (text === undefined) openFiles.delete(path);
            else openFiles.set(path, text);
            changed();
        },

        fileChanged(path) {
            diskTexts.delete(path);
            changed();
        },

        setMainFile(path) {
            mainFile = path;
            changed();
        },

        async getAnalysis() {
            return (await getIndex()).analysis;
        },

        async getDiagnostics(path) {
            const index = await getIndex();
            return index.analysis.diagnostics.filter(d => d.file == path);
        },

        async getDocumentSymbols(path) {
            const index = await getIndex();
            const tree = await getFile(index, path);
            if (!tree) return [];
            const { file } = tree;
            const symbols: DocumentSymbol[] = [];

            const passageSymbols = (node: SectionNode) => node.passages.map((p): DocumentSymbol => ({
                name: p.name, kind: "passage", range: p.range, selectionRange: p.nameRange, children: [],
            }));

            for (const node of [file.preamble, ...file.sections]) {
                if (node.type == "snippet") {
                    symbols.push({ name: node.name, kind: "snippet", range: node.range, selectionRange: node.nameRange, children: [] });
                    continue;
                }
                for (const statement of node.body) {
                    if (statement.type == "title") {
                        symbols.push({ name: statement.value, kind: "title", range: statement.range, selectionRange: statement.valueRange, children: [] });
                    }
                }
                for (const passage of node.passages) {
                    for (const statement of passage.body) {
                        if (statement.type == "title") {
                            symbols.push({ name: statement.value, kind: "title", range: statement.range, selectionRange: statement.valueRange, children: [] });
                        }
                    }
                }
                const storyName = index.nodeNames.get(node);
                if (node.kind == "preamble") {
                    // Only a section if the story made it one (the main file's _default section)
                    if (storyName === undefined) continue;
                    symbols.push({ name: storyName, kind: "section", range: node.range, selectionRange: node.range, children: passageSymbols(node) });
                    continue;
                }
                const header = node.header!;
                const detail = header.type == "continue" ? `+++${header.text}` : header.type == "separator" ? "---" : undefined;
                symbols.push({
                    name: node.name ?? storyName ?? detail ?? "",
                    kind: "section",
                    ...(node.kind != "named" && detail ? { detail } : {}),
                    range: node.range,
                    selectionRange: node.nameRange ?? header.range,
                    children: passageSymbols(node),
                });
            }
            return symbols;
        },

        async getDefinition(path, position) {
            const index = await getIndex();
            const found = await symbolAt(index, path, position);
            return found && definitionOf(index, found.symbol);
        },

        async getReferences(path, position, includeDeclaration = true) {
            const index = await getIndex();
            const found = await symbolAt(index, path, position);
            return found ? referencesTo(index, found.symbol, includeDeclaration) : [];
        },

        async getRenameEdits(path, position, newName) {
            const index = await getIndex();
            const found = await symbolAt(index, path, position);
            if (!found) return undefined;
            const { symbol } = found;

            if (newName != newName.trim() || !newName) return { error: "A name can't be empty or start or end with a space." };
            if (/[[\]\n,"]/.test(newName)) return { error: "A name can't contain [, ], a comma or a double quote." };
            if (symbol.kind == "passage" && (symbol.name.startsWith("@") || newName.startsWith("@"))) {
                return { error: "Passages whose names start with @ are special, and can't be renamed." };
            }
            const definition = definitionOf(index, symbol);
            const definitionNode = symbol.kind == "section" ? index.sections.get(symbol.name)?.node : undefined;
            if (!definition || (symbol.kind == "section" && !definitionNode?.nameRange)) {
                return { error: `'${symbol.name}' doesn't have a name of its own to rename.` };
            }
            const exists = symbol.kind == "section"
                ? index.sections.has(newName)
                : index.sections.get(symbol.section)?.passages.has(newName);
            if (exists && newName != symbol.name) {
                return { error: `There's already a ${symbol.kind} called '${newName}'.` };
            }

            const edit: WorkspaceEdit = {};
            addEdit(edit, definition.file, { range: definition.range, newText: newName });
            for (const usage of index.usages) {
                const target = resolveUsage(index, usage);
                if (!target || !sameSymbol(target, symbol)) continue;
                const range = nameRangeInLink(index, usage, symbol.name);
                if (range) addEdit(edit, usage.file, { range, newText: newName });
            }
            return { edit };
        },

        async getCompletions(path, position) {
            const index = await getIndex();
            const tree = await getFile(index, path);
            if (!tree) return [];
            const prefix = (tree.text.replace(/\r/g, "").split("\n")[position.line] ?? "").substring(0, position.character);
            const { section } = containerAt(tree.file, position);
            const sectionName = section && index.nodeNames.get(section);
            const replace = (typed: string): Range => lineRange(position.line, position.character - typed.length, position.character);

            const sectionItems = (typed: string): CompletionItem[] => index.sectionNames
                .filter(name => !name.startsWith("_continue"))
                .map(name => ({ label: name, kind: "section", range: replace(typed) }));
            const passageItems = (typed: string): CompletionItem[] => {
                const passages = sectionName === undefined ? undefined : index.sections.get(sectionName)?.passages;
                return [...(passages?.keys() ?? [])]
                    .filter(name => !name.startsWith("@"))
                    .map(name => ({ label: name, kind: "passage", range: replace(typed) }));
            };

            let match;
            if ((match = /\{\{~?\s*embed\s+["']([^"']*)$/.exec(prefix))) {
                return [...passageItems(match[1]), ...sectionItems(match[1])];
            }
            if ((match = /\[\[[^\]]*\]\]\(([^),]*)$/.exec(prefix))) {
                return sectionItems(match[1]);
            }
            if ((match = /(?<![![])\[[^\]]*\]\(([^),]*)$/.exec(prefix))) {
                return passageItems(match[1]);
            }
            if ((match = /\[\[([^\]>]*)$/.exec(prefix))) {
                return sectionItems(match[1]);
            }
            if ((match = /(?<![![])\[([^[\]]*)$/.exec(prefix))) {
                return passageItems(match[1]);
            }
            if ((match = /^\s*@(?:set|unset|inc|dec)\s+(?:not\s+)?([^\s=]*)$/.exec(prefix))) {
                return [...index.attributes].sort().map(name => ({ label: name, kind: "attribute", range: replace(match![1]) }));
            }
            if ((match = /^(\w*)$/.exec(prefix))) {
                return index.snippets.map(({ node }) => ({
                    label: node.name,
                    kind: "snippet",
                    insertText: node.content.replace(/\s+$/, ""),
                    range: replace(match![1]),
                }));
            }
            return [];
        },

        async getHover(path, position) {
            const index = await getIndex();
            const found = await symbolAt(index, path, position);
            if (!found?.usage) return undefined;
            const { symbol } = found;
            let node: SectionNode | PassageNode | undefined;
            let heading: string;
            if (symbol.kind == "section") {
                node = index.sections.get(symbol.name)?.node;
                heading = `[[${symbol.name}]]`;
            }
            else {
                node = index.sections.get(symbol.section)?.passages.get(symbol.name);
                heading = `[${symbol.name}] in [[${symbol.section}]]`;
            }
            if (!node) return undefined;
            const preview = firstLines(node, 5);
            return { contents: preview ? `**${heading}**\n\n${preview}` : `**${heading}**`, range: found.range };
        },

        async getFoldingRanges(path) {
            const index = await getIndex();
            const tree = await getFile(index, path);
            if (!tree) return [];
            const lines = tree.text.replace(/\r/g, "").split("\n");
            const ranges: FoldingRange[] = [];
            const add = (range: Range) => {
                let end = range.end.line;
                while (end > range.start.line && !lines[end]?.trim()) end--;
                if (end > range.start.line) ranges.push({ startLine: range.start.line, endLine: end });
            };
            for (const node of tree.file.sections) {
                add(node.range);
                if (node.type == "section") node.passages.forEach(p => add(p.range));
            }
            tree.file.preamble.passages.forEach(p => add(p.range));
            return ranges;
        },

        async getCodeActions(path, range) {
            const index = await getIndex();
            const tree = await getFile(index, path);
            if (!tree) return [];
            const actions: CodeAction[] = [];
            const diagnostics = index.analysis.diagnostics.filter(d => d.file == path && overlaps(d.range, range));
            const v5 = findV5Syntax(tree.text);
            const lines = tree.text.replace(/\r/g, "").split("\n");

            for (const diagnostic of diagnostics) {
                if (diagnostic.code == "squiffy/unknown-section-link" || diagnostic.code == "squiffy/unknown-passage-link") {
                    const usage = index.usages.find(u => u.file == path && u.link
                        && comparePositions(u.link.range.start, diagnostic.range.start) == 0);
                    if (!usage?.link) continue;
                    const name = intendedName(usage.link.target);
                    if (!name) continue;
                    const edit: WorkspaceEdit = {};
                    if (diagnostic.code == "squiffy/unknown-section-link") {
                        const end = endOfText(tree.text.replace(/\r/g, ""));
                        const before = lines[lines.length - 1] == "" ? "\n" : "\n\n";
                        addEdit(edit, path, { range: { start: end, end }, newText: `${before}[[${name}]]:\n` });
                        actions.push({ title: `Create section '${name}'`, kind: "quickfix", diagnostic, edit });
                    }
                    else {
                        // At the end of the section the link is in
                        const end = usage.sectionNode.range.end;
                        const blank = !lines[end.line]?.trim();
                        addEdit(edit, path, { range: { start: end, end }, newText: `${blank ? "" : "\n\n"}[${name}]:\n` });
                        actions.push({ title: `Create passage '${name}'`, kind: "quickfix", diagnostic, edit });
                    }
                }
                else if (diagnostic.code == "squiffy/v5-syntax") {
                    const line = diagnostic.range.start.line;
                    const match = v5.find(m => m.line == line + 1
                        && lines[line].substring(diagnostic.range.start.character).startsWith(m.text));
                    if (!match?.suggestion || match.text.includes("\n")) continue;
                    const start = diagnostic.range.start;
                    const edit: WorkspaceEdit = {};
                    addEdit(edit, path, {
                        range: { start, end: { line, character: start.character + match.text.length } },
                        newText: match.suggestion,
                    });
                    actions.push({ title: `Convert to ${match.suggestion}`, kind: "quickfix", diagnostic, edit });
                }
            }

            if (diagnostics.some(d => d.code == "squiffy/v5-syntax")) {
                const converted = convertV5Syntax(tree.text);
                if (converted.converted > 0) {
                    const edit: WorkspaceEdit = {};
                    addEdit(edit, path, { range: { start: { line: 0, character: 0 }, end: endOfText(tree.text) }, newText: converted.script });
                    actions.push({ title: "Convert all Squiffy 5 syntax in this file", kind: "quickfix", edit });
                }
            }
            return actions;
        },

        async getSectionAt(path, position) {
            const index = await getIndex();
            const tree = await getFile(index, path);
            if (!tree) return undefined;
            const { section, passage } = containerAt(tree.file, position);
            if (!section) return undefined;
            const name = index.nodeNames.get(section);
            if (name === undefined) return undefined;
            return passage && index.sections.get(name)?.passages.get(passage.name) === passage
                ? { section: name, passage: passage.name }
                : { section: name };
        },
    };
}
