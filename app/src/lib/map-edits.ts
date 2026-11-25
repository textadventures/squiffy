// Edits to the script made from the story map: where a new section or passage goes, what deleting
// one removes, setting where the story starts, and marking an ending. All worked out from the story graph and a
// file's text, so they can be tested without an editor.
import type { GraphNode, Place, StoryGraph, TextEdit } from "squiffy-compiler/language-service";
import { blockOf, insertHeaderEdit } from "squiffy-compiler/language-service";

// Where a new section goes, and the edit that adds its header, are in the compiler, as its
// "Create section" quick fix puts a section in the same place
export { blockOf, insertHeaderEdit, placeNewSection, type Place } from "squiffy-compiler/language-service";

const splitLines = (text: string) => text.split(/\r?\n/);
const blank = (line: string | undefined) => line === undefined || !line.trim();

const sectionOf = (node: GraphNode) => node.kind == "section" ? node.name : node.section!;

// Where a new passage goes: at the end of its section, after the passages it has
export function placeNewPassage(section: GraphNode): Place {
    return { file: section.location.file, afterLine: section.range.end.line };
}

// A link, and the header of the new section or passage it links to, which has to come after it.
// A link on a blank line under a section's text (where the cursor is in a section that's empty,
// say) is past where the header would go, so there the header follows the link instead.
export function linkThenHeaderEdits(text: string, link: TextEdit, afterLine: number | undefined, header: string): TextEdit[] {
    const headerEdit = insertHeaderEdit(text, afterLine, header);
    const at = link.range.start, headerAt = headerEdit.range.start;
    // At the same place, they're one edit, so that the order's certain
    if (at.line == headerAt.line && at.character == headerAt.character && link.range.end.line == at.line && link.range.end.character == at.character) {
        return [{ range: link.range, newText: link.newText + headerEdit.newText }];
    }
    if (at.line < headerAt.line || (at.line == headerAt.line && at.character < headerAt.character)) return [link, headerEdit];
    const lines = splitLines(text);
    const needsLine = link.range.end.line + 1 >= lines.length || !blank(lines[link.range.end.line + 1]);
    return [{ range: link.range, newText: `${link.newText}\n\n${header}${needsLine ? "\n" : ""}` }];
}

// Removes whole lines (each range is its first and last line), with the blank lines after them.
// Ranges that touch, or have only blank lines between them, are removed as one.
export function deleteLinesEdits(text: string, ranges: { start: number; end: number }[]): TextEdit[] {
    const lines = splitLines(text);
    const max = lines.length - 1;
    const nextText = (line: number) => {
        let n = line;
        while (n <= max && blank(lines[n])) n++;
        return n;
    };
    const merged: { start: number; next: number }[] = [];
    for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
        if (range.start > max) continue;
        // Up to the next line with anything on it
        const next = nextText(Math.min(range.end, max) + 1);
        const before = merged[merged.length - 1];
        if (before && range.start <= before.next) before.next = Math.max(before.next, next);
        else merged.push({ start: range.start, next });
    }
    return merged.map(({ start, next }) => {
        if (next <= max) return { range: { start: { line: start, character: 0 }, end: { line: next, character: 0 } }, newText: "" };
        // Nothing after it: back to the end of the text before, leaving the file's last line break
        const end = { line: max, character: lines[max].length };
        let before = start - 1;
        while (before >= 0 && blank(lines[before])) before--;
        if (before < 0) return { range: { start: { line: 0, character: 0 }, end }, newText: "" };
        return { range: { start: { line: before, character: lines[before].length }, end }, newText: /\n$/.test(text) ? "\n" : "" };
    });
}

export interface Deletion {
    // Everything that goes, for the message: the sections and passages chosen, without passages
    // whose section is going anyway
    chosen: GraphNode[];
    // Lines to remove (first and last), by file
    ranges: Map<string, { start: number; end: number }[]>;
    // Sections without names of their own that follow on from a section that's going, so go too
    continuations: number;
    // Passages that go with their sections
    passages: number;
    // Links from what's left to what's going that are on lines of their own, as the map adds
    // them: they go too
    removedLinks: number;
    // Other links from what's left to what's going, in among other text, which will be broken
    brokenLinks: number;
    // The story starts at one of them
    start: boolean;
}

// What deleting sections and passages from the map removes. A section goes with its passages and
// the +++ and --- sections that follow on from it, which would otherwise carry on from whatever
// section came before. Sections without names of their own, and the master section, can't be
// deleted from the map: undefined if there's nothing that can be.
//
// A link to something that's going, on a line of its own, goes with it: that's how the map adds a
// link, so deleting a section just made from the map leaves nothing behind. It needs the text of
// the files (`texts`, by path) to tell; without it, every link is left, and counted as broken. A
// link in among other text is always left for the author to reword.
export function planDeletion(graph: StoryGraph, nodes: GraphNode[], texts?: ReadonlyMap<string, string>): Deletion | undefined {
    const sections = nodes.filter(n => n.kind == "section" && !n.detail && n.name != "");
    const goingSections = new Map<string, GraphNode>();
    let continuations = 0;
    for (const section of sections) {
        // From the section itself: a (Start) or +++ before it in its run stays
        const block = blockOf(graph, section);
        for (const s of block.slice(block.findIndex(b => b.id == section.id))) {
            if (goingSections.has(s.name)) continue;
            goingSections.set(s.name, s);
            if (s.detail) continuations++;
        }
    }
    const passages = nodes.filter(n => n.kind == "passage" && !goingSections.has(n.section!));
    const chosen = [...sections, ...passages];
    if (!chosen.length) return undefined;

    const going = new Set<string>(passages.map(p => p.id));
    let withSections = 0;
    for (const n of graph.nodes) {
        if (n.kind == "section" ? goingSections.has(n.name) : goingSections.has(n.section!)) {
            going.add(n.id);
            if (n.kind == "passage") withSections++;
        }
    }
    const ranges = new Map<string, { start: number; end: number }[]>();
    for (const n of [...goingSections.values(), ...passages]) {
        let list = ranges.get(n.location.file);
        if (!list) ranges.set(n.location.file, list = []);
        list.push({ start: n.range.start.line, end: n.range.end.line });
    }
    let removedLinks = 0;
    let brokenLinks = 0;
    const lines = new Map<string, string[]>();
    const removed = new Set<string>();
    for (const edge of graph.edges) {
        if (!edge.to || !going.has(edge.to) || going.has(edge.from)) continue;
        const { file, range } = edge.location;
        const text = texts?.get(file);
        let fileLines = lines.get(file);
        if (!fileLines && text !== undefined) lines.set(file, fileLines = splitLines(text));
        const line = fileLines?.[range.start.line];
        const alone = line !== undefined && range.end.line == range.start.line && (edge.kind == "section-link" || edge.kind == "passage-link")
            && line.trim() == line.slice(range.start.character, range.end.character) && line.trim() != "";
        if (!alone) {
            brokenLinks++;
            continue;
        }
        removedLinks++;
        const key = `${file}:${range.start.line}`;
        if (removed.has(key)) continue;
        removed.add(key);
        let list = ranges.get(file);
        if (!list) ranges.set(file, list = []);
        list.push({ start: range.start.line, end: range.start.line });
    }
    return {
        chosen, ranges, continuations, removedLinks, brokenLinks,
        passages: withSections,
        start: [...goingSections.values()].some(s => s.start),
    };
}

// What to ask before deleting
export function deletionMessage(d: Deletion): string {
    const count = (n: number, one: string, many = `${one}s`) => `${n} ${n == 1 ? one : many}`;
    const sections = d.chosen.filter(n => n.kind == "section");
    const passages = d.chosen.filter(n => n.kind == "passage");
    const what = d.chosen.length == 1
        ? `the ${d.chosen[0].kind} "${d.chosen[0].name}"`
        : [sections.length ? count(sections.length, "section") : "", passages.length ? count(passages.length, "passage") : ""].filter(Boolean).join(" and ");
    const one = sections.length == 1;
    const notes = [
        d.passages ? `${one ? "Its" : "Their"} ${d.passages == 1 ? "passage goes" : `${d.passages} passages go`} too.` : "",
        d.continuations ? `So ${d.continuations == 1 ? "does the section" : `do the ${d.continuations} sections`} that ${d.continuations == 1 ? "follows" : "follow"} on from ${one ? "it" : "them"} (+++ or ---).` : "",
        d.removedLinks ? `${d.removedLinks == 1 ? "The link" : `The ${d.removedLinks} links`} to ${d.chosen.length == 1 ? "it" : "them"} on ${d.removedLinks == 1 ? "a line of its own goes" : "lines of their own go"} too.` : "",
        d.brokenLinks ? `${count(d.brokenLinks, d.removedLinks ? "other link" : "link")} to ${d.chosen.length == 1 ? "it" : "them"} will be broken.` : "",
        d.start ? "The story starts there, so it will start somewhere else." : "",
    ].filter(Boolean);
    return [`Delete ${what}?`, ...notes].join(" ");
}

// Why a name can't be used for a new passage in a section, if it can't
export function checkPassageName(name: string, section: string, graph: StoryGraph): string | undefined {
    if (!name || name != name.trim()) return "A name can't be empty or start or end with a space.";
    if (/[[\]\n,"]/.test(name)) return "A name can't contain [, ], a comma or a double quote.";
    if (name.startsWith("@")) return "Passages whose names start with @ run on their own, so add those in the script.";
    if (/^snippet:/i.test(name)) return "A name can't start with \"snippet:\".";
    if (graph.nodes.some(n => n.kind == "passage" && n.section == section && n.name == name)) return `This section already has a passage called '${name}'.`;
    return undefined;
}

// Makes the story start at a section: changes the main file's @start line, or adds one at the top
// (after @title, if that's there)
// Marks a section as one of the story's endings: @end on the line after its header, as the
// language service's quick fix for a dead end does
export function endingEdit(text: string, section: GraphNode): TextEdit {
    const lines = splitLines(text);
    const line = section.location.range.start.line + 1;
    if (line < lines.length) return { range: { start: { line, character: 0 }, end: { line, character: 0 } }, newText: "@end\n" };
    const end = { line: line - 1, character: lines[line - 1].length };
    return { range: { start: end, end }, newText: "\n@end" };
}

// Takes out a section's @end lines, when a link from it (or one of its passages) to another
// section means it's no longer where the story stops. Each goes with the line break before it,
// so a link added at the end of the section's text, which may be where an @end line ends,
// doesn't overlap it.
export function endingRemovalEdits(graph: StoryGraph, from: GraphNode, text: string): TextEdit[] {
    const name = sectionOf(from);
    const section = graph.nodes.find(n => n.kind == "section" && n.name == name);
    const lines = splitLines(text);
    return (section?.endRanges ?? []).map(({ start: { line } }): TextEdit => line == 0
        ? { range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }, newText: "" }
        : { range: { start: { line: line - 1, character: lines[line - 1].length }, end: { line, character: lines[line].length } }, newText: "" });
}

// A line with a directive on it, such as @end or @set, where a link typed at the cursor would
// break it
export const isDirectiveLine = (line: string) => /^\s*@/.test(line);

export function startEdit(mainText: string, name: string): TextEdit {
    const lines = splitLines(mainText);
    const existing = lines.findIndex(line => /^@start /.test(line));
    if (existing >= 0) {
        return { range: { start: { line: existing, character: 0 }, end: { line: existing, character: lines[existing].length } }, newText: `@start ${name}` };
    }
    let line = 0;
    while (line < lines.length && /^@title /.test(lines[line])) line++;
    const at = line < lines.length ? { line, character: 0 } : { line: lines.length - 1, character: lines[lines.length - 1].length };
    return { range: { start: at, end: at }, newText: line < lines.length ? `@start ${name}\n` : `\n@start ${name}\n` };
}
