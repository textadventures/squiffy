import type {
    DeactivateNode, EmbedNode, GotoNode, LinkNode, PassageNode, Range, SectionNode, SnippetNode, SquiffyFile, StatementNode, TextNode,
} from "./syntax.js";
import { positionMapper, transformText } from "./text.js";

export const lineRegexes = {
    section: /^\[\[(.*)\]\]:$/,
    snippet: /^\[snippet:\s*(.+)\]:$/,
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
    music: /^@music (.*)$/,
    sound: /^@sound (.*)$/,
    class: /^@class (.*)$/,
    tag: /^@tag (.*)$/,
    transition: /^@(transition|leave) (\S+)(?: (\S+))?$/,
};

// Parses one .squiffy file into a syntax tree. This never fails: problems such as a passage
// with no section are reported by analyse(), which knows how the file fits into the story.
//
// Each line is classified exactly as the compiler always has (see the if/else chain below,
// whose order matters). The tree is grouped as if this is the story's main file: in an imported
// file, content before the first section is ignored, and analyse() deals with that.
export function parse(text: string, filename?: string): SquiffyFile {
    const lines = text.replace(/\r/g, "").split("\n");

    const lineRange = (line: number): Range => ({
        start: { line, character: 0 },
        end: { line, character: lines[line].length },
    });
    // The range of a substring of a line, found by searching from the end, since every
    // value this is used for runs to the end of the (trimmed) line.
    const valueRange = (line: number, value: string): Range => {
        const trimmedEnd = lines[line].trimEnd().length;
        const start = Math.max(0, trimmedEnd - value.length);
        return { start: { line, character: start }, end: { line, character: start + value.length } };
    };
    const nameRange = (line: number, name: string, prefix: string): Range => {
        const lineText = lines[line];
        const start = lineText.indexOf(name, lineText.indexOf(prefix) + prefix.length);
        return { start: { line, character: start }, end: { line, character: start + name.length } };
    };

    const preamble = newSection("preamble", { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } });
    const file: SquiffyFile = {
        type: "file",
        filename,
        range: { start: { line: 0, character: 0 }, end: { line: lines.length - 1, character: lines[lines.length - 1].length } },
        preamble,
        sections: [],
    };

    let section = preamble;
    let passage: PassageNode | null = null;
    let snippet: SnippetNode | null = null;
    const snippetLines: string[] = [];
    // Whether the compiler would have a current section at this point. In the main file, content
    // before any section header creates the "_default" section.
    let haveSection = false;
    let textStarted = false;
    let inUiBlock = false;

    const endSnippet = () => {
        if (snippet) {
            snippet.content = snippetLines.join("\n");
            snippetLines.length = 0;
            snippet = null;
        }
    };
    const startSection = (node: SectionNode) => {
        endSnippet();
        section = node;
        passage = null;
        file.sections.push(node);
    };
    const add = (node: StatementNode) => {
        (passage ?? section).body.push(node);
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const stripLine = line.trim();
        const range = lineRange(i);

        const match: Partial<Record<keyof typeof lineRegexes, RegExpExecArray>> = {};
        for (const key of Object.keys(lineRegexes) as (keyof typeof lineRegexes)[]) {
            const result = lineRegexes[key].exec(key == "js" ? line : stripLine);
            if (result) {
                match[key] = result;
            }
        }

        if (match.snippet) {
            endSnippet();
            const name = match.snippet[1];
            snippet = {
                type: "snippet",
                name,
                nameRange: nameRange(i, name, "snippet:"),
                header: { type: "snippet-header", name, range },
                range,
                content: "",
            };
            file.sections.push(snippet);
            passage = null;
            haveSection = false;
            textStarted = false;
        }
        else if (match.section) {
            const name = match.section[1];
            const node = newSection("named", range);
            node.name = name;
            node.nameRange = nameRange(i, name, "[[");
            node.header = { type: "section-header", name, range };
            startSection(node);
            haveSection = true;
            textStarted = false;
        }
        else if (snippet) {
            snippetLines.push(line);
        }
        else if (match.passage) {
            const name = match.passage[1];
            const header = { type: "passage-header" as const, name, range };
            passage = {
                type: "passage",
                name,
                nameRange: nameRange(i, name, "["),
                header,
                range,
                body: [],
                links: [],
                embeds: [],
                gotos: [], deactivates: [],
            };
            section.passages.push(passage);
            textStarted = false;
        }
        else if (match.continue) {
            const node = newSection("continue", range);
            node.header = { type: "continue", text: match.continue[1], range };
            startSection(node);
            haveSection = true;
            textStarted = false;
        }
        else if (stripLine == "---") {
            inUiBlock = false;
            if (!haveSection) {
                add({ type: "separator", range });
            }
            else {
                const node = newSection("separator", range);
                node.header = { type: "separator", range };
                startSection(node);
                textStarted = false;
            }
        }
        else if (stripLine == "@ui") {
            inUiBlock = true;
            add({ type: "ui-block-start", range });
        }
        else if (match.ui) {
            add({ type: "ui-file", path: match.ui[1], pathRange: valueRange(i, match.ui[1]), range });
        }
        else if (stripLine == "@clear") {
            if (!passage) haveSection = true;
            add({ type: "clear", range });
        }
        else if (stripLine == "@repeat") {
            add({ type: "repeat", range });
        }
        else if (stripLine == "@end") {
            if (!passage) haveSection = true;
            add({ type: "end", range });
        }
        else if (match.title) {
            add({ type: "title", value: match.title[1], valueRange: valueRange(i, match.title[1]), range });
        }
        else if (match.start) {
            add({ type: "start", value: match.start[1], valueRange: valueRange(i, match.start[1]), range });
        }
        else if (match.import) {
            add({ type: "import", pattern: match.import[1], patternRange: valueRange(i, match.import[1]), range });
        }
        else if (match.music || match.sound) {
            if (!passage) haveSection = true;
            const value = (match.music ?? match.sound)![1];
            add({ type: "sound", directive: match.music ? "music" : "sound", value, valueRange: valueRange(i, value), range });
        }
        else if (match.class) {
            if (!passage) haveSection = true;
            add({ type: "class", value: match.class[1], valueRange: valueRange(i, match.class[1]), range });
        }
        else if (match.tag) {
            if (!passage) haveSection = true;
            add({ type: "tag", value: match.tag[1], valueRange: valueRange(i, match.tag[1]), range });
        }
        else if (match.transition) {
            if (!passage) haveSection = true;
            const [, directive, value, time] = match.transition;
            const start = line.indexOf(value, line.indexOf("@") + directive.length + 1);
            add({
                type: "transition",
                directive: directive as "transition" | "leave",
                value,
                valueRange: { start: { line: i, character: start }, end: { line: i, character: start + value.length } },
                ...(time === undefined ? {} : { time }),
                range,
            });
        }
        else if (match.attributes || match.unset) {
            haveSection = true;
            const value = (match.attributes ?? match.unset)![1];
            add({ type: "attribute", directive: match.attributes ? "set" : "unset", value, valueRange: valueRange(i, value), range });
        }
        else if (match.inc || match.dec) {
            haveSection = true;
            const m = (match.inc ?? match.dec)!;
            const value = m[1];
            const start = line.indexOf(value, line.indexOf("@") + 4);
            add({
                type: "attribute",
                directive: match.inc ? "inc" : "dec",
                value,
                valueRange: { start: { line: i, character: start }, end: { line: i, character: start + value.length } },
                ...(m[2] === undefined ? {} : { amount: m[2] }),
                range,
            });
        }
        else if (!textStarted && match.js) {
            if (!inUiBlock && !passage) haveSection = true;
            const indent = match.js[1].length;
            add({
                type: "js",
                code: match.js[2],
                codeRange: { start: { line: i, character: indent }, end: { line: i, character: line.length } },
                range,
            });
        }
        else if (textStarted || stripLine.length > 0) {
            add({ type: "text", text: line, range });
            if (!inUiBlock) {
                if (!passage) haveSection = true;
                textStarted = true;
            }
        }
        // Otherwise it's a blank line before any text, which is ignored.

        const end = range.end;
        if (snippet) snippet.range = { start: snippet.range.start, end };
        else {
            section.range = { start: section.range.start, end };
            if (passage) passage.range = { start: passage.range.start, end };
        }
    }
    endSnippet();

    for (const s of [preamble, ...file.sections]) {
        if (s.type != "section") continue;
        findLinks(s, lines);
        for (const p of s.passages) {
            findLinks(p, lines);
        }
    }

    return file;
}

function newSection(kind: SectionNode["kind"], range: Range): SectionNode {
    return { type: "section", kind, range, body: [], passages: [], links: [], embeds: [], gotos: [], deactivates: [] };
}

// Fills in the links, embeds and gotos in a section's or passage's text.
function findLinks(node: SectionNode | PassageNode, lines: string[]) {
    const textNodes = node.body.filter((n): n is TextNode => n.type == "text");
    if (!textNodes.length) return;

    const sources = textNodes.map(n => ({ line: n.range.start.line, length: lines[n.range.start.line].length }));
    const toPosition = positionMapper(sources, textNodes.map(n => n.text.length));
    const toRange = (start: number, end: number): Range => ({ start: toPosition(start), end: toPosition(end) });

    // Which section comes next isn't known until the story is analysed, but all that matters
    // here is that there is one, so that [[text>]] is treated as a link. Link
    // targets can have brackets in them, as in a story with a squiffy.json, whether or not this
    // one has one: the two only differ when a target has a "(" in it.
    const result = transformText(textNodes.map(n => n.text).join("\n"), () => "", true);

    node.links = result.links.map((link): LinkNode => ({
        type: "link",
        linkType: link.linkType,
        form: link.form,
        ...(link.text === undefined ? {} : { text: link.text }),
        target: link.target,
        range: toRange(link.start, link.end),
        targetRange: toRange(link.targetStart, link.targetEnd),
    }));
    node.embeds = result.embeds.map((embed): EmbedNode => ({
        type: "embed",
        name: embed.name,
        range: toRange(embed.start, embed.end),
        nameRange: toRange(embed.nameStart, embed.nameEnd),
    }));
    node.gotos = result.gotos.map((goto): GotoNode => ({
        type: "goto",
        name: goto.name,
        range: toRange(goto.start, goto.end),
        nameRange: toRange(goto.nameStart, goto.nameEnd),
    }));
    node.deactivates = result.deactivates.map((deactivate): DeactivateNode => ({
        type: "deactivate",
        name: deactivate.name,
        range: toRange(deactivate.start, deactivate.end),
        nameRange: toRange(deactivate.nameStart, deactivate.nameEnd),
    }));
}
