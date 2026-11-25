// Where a new section goes in the script, and the edit that adds its header. Shared by the
// language service's "Create section" quick fix and the editor's story map (app/src/lib/map-edits.ts),
// so a section added either way goes in the same place.
import type { TextEdit } from "./language-service.js";
import type { GraphNode, StoryGraph } from "./story-graph.js";

const NAVIGATION: ReadonlySet<string> = new Set(["section-link", "goto", "script"]);

const splitLines = (text: string) => text.split(/\r?\n/);
const blank = (line: string | undefined) => line === undefined || !line.trim();

const sectionOf = (node: GraphNode) => node.kind == "section" ? node.name : node.section!;

// A file's sections, in the order they're written
function sectionsIn(graph: StoryGraph, file: string): GraphNode[] {
    return graph.nodes
        .filter(n => n.kind == "section" && n.location.file == file)
        .sort((a, b) => a.range.start.line - b.range.start.line);
}

// A section with everything that follows on from it: the sections without names of their own
// (+++ and --- lines) between it and the next named section, which only make sense after it. For
// one of those, the whole run it's part of.
export function blockOf(graph: StoryGraph, section: GraphNode): GraphNode[] {
    const sections = sectionsIn(graph, section.location.file);
    const index = sections.findIndex(s => s.id == section.id);
    if (index < 0) return [section];
    let first = index;
    while (first > 0 && sections[first].detail) first--;
    let last = index;
    while (last + 1 < sections.length && sections[last + 1].detail) last++;
    return sections.slice(first, last + 1);
}

export interface Place {
    file: string;
    // The last line of what the new section goes after. Undefined for the end of the file.
    afterLine?: number;
}

// Where a new section goes in the script, so the file stays in a sensible order rather than
// everything new piling up at the end.
//
// Linked from a section (or one of its passages): after the last of that section's own children
// that come after it in the same file, so the choices it leads to follow it in the order they were
// made, or straight after it if it has none. A child is its own if it's the first to link there,
// so a link to a shared section (an ending, say) far down the file doesn't take the new one there.
//
// Otherwise, after the section it was made near, or at the end of the file.
export function placeNewSection(graph: StoryGraph, where: { from?: GraphNode; near?: GraphNode; file: string }): Place {
    const anchor = where.from ?? where.near;
    const section = anchor && graph.nodes.find(n => n.kind == "section" && n.name == sectionOf(anchor));
    // The master section's text is part of every section, so nothing belongs after it in particular
    if (!section || section.name == "" || section.location.file != where.file) return { file: where.file };
    const block = blockOf(graph, section);
    let after = block[block.length - 1];

    if (where.from) {
        const inBlock = new Set(block.map(s => s.name));
        const byId = new Map(graph.nodes.map(n => [n.id, n]));
        // For each section, the first thing to link to it: in its own file if anything there does
        const firstLinker = new Map<string, { own: boolean; line: number; section: string }>();
        for (const edge of graph.edges) {
            if (!edge.to || !NAVIGATION.has(edge.kind)) continue;
            const to = byId.get(edge.to);
            const from = byId.get(edge.from);
            if (!to || !from || to.kind != "section") continue;
            const linker = { own: edge.location.file == to.location.file, line: edge.location.range.start.line, section: sectionOf(from) };
            const best = firstLinker.get(to.id);
            if (!best || (linker.own && !best.own) || (linker.own == best.own && linker.line < best.line)) firstLinker.set(to.id, linker);
        }
        for (const child of sectionsIn(graph, where.file)) {
            if (child.detail || child.name == "" || child.range.start.line <= after.range.start.line) continue;
            const linker = firstLinker.get(child.id);
            if (!linker?.own || !inBlock.has(linker.section)) continue;
            const childBlock = blockOf(graph, child);
            after = childBlock[childBlock.length - 1];
        }
    }
    return { file: where.file, afterLine: after.range.end.line };
}

// Adds a header ("[[name]]:" or "[name]:") on a line of its own after a line (or at the end),
// with a blank line either side. Blank lines already there are left as they are.
export function insertHeaderEdit(text: string, afterLine: number | undefined, header: string): TextEdit {
    const lines = splitLines(text);
    let last = Math.min(afterLine ?? lines.length - 1, lines.length - 1);
    while (last >= 0 && blank(lines[last])) last--;
    if (last < 0) {
        const start = { line: 0, character: 0 };
        return { range: { start, end: start }, newText: `${header}\n${text.trim() ? "\n" : ""}` };
    }
    const at = { line: last, character: lines[last].length };
    // A line of its own, and a blank line before what follows, if there isn't one
    const needsLine = last + 1 >= lines.length || !blank(lines[last + 1]);
    return { range: { start: at, end: at }, newText: `\n\n${header}${needsLine ? "\n" : ""}` };
}
