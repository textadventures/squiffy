// What editing on the story map does to the story, as the editor's map does it
// (app/src/routes/edit/+page.svelte). Kept apart from VS Code's API, to be tested.

import type { MapPositions } from "squiffy-compiler";
import type { GraphNode, Position, StoryGraph, TextEdit } from "squiffy-compiler/language-service";
import { endingRemovalEdits, insertHeaderEdit, isDirectiveLine, linkThenHeaderEdits, placeNewPassage, placeNewSection } from "@textadventures/squiffy-app/map-edits";
import { emptyPositions, linkTo, nodeAtLine, sectionKeys, withPosition } from "@textadventures/squiffy-app/story-map";
import type { Point } from "../map/messages.js";

// Where the cursor is: a file (as a path from the story's folder) and a position in it
export interface Cursor {
    file: string;
    position: Position;
    // The text of the cursor's line
    lineText?: string;
}

// The edit that adds a link from one node to another: at the cursor, if it's in the node the link
// is from (below its header), or else after the node's own text. Or why there can't be a link.
export function linkEdit(graph: StoryGraph, fromId: string, toId: string, cursor?: Cursor): { file: string; edit: TextEdit } | { error: string } {
    const from = graph.nodes.find(n => n.id == fromId), to = graph.nodes.find(n => n.id == toId);
    if (!from || !to) return { error: "The story has changed. Try again." };
    const link = linkTo(from, to);
    if ("error" in link) return link;
    return { file: from.location.file, edit: addLink(graph, from, link.text, cursor) };
}

function addLink(graph: StoryGraph, from: GraphNode, text: string, cursor?: Cursor): TextEdit {
    const file = from.location.file;
    if (cursor?.file == file) {
        const at = cursor.position;
        if (nodeAtLine(graph, file, at.line)?.id == from.id && at.line > from.location.range.start.line
            && !(cursor.lineText !== undefined && isDirectiveLine(cursor.lineText))) {
            return { range: { start: at, end: at }, newText: text };
        }
    }
    const at = from.contentEnd;
    const headerOnly = at.line == from.location.range.start.line;
    return { range: { start: at, end: at }, newText: `${headerOnly ? "\n" : "\n\n"}${text}` };
}

// A link from a section marked with @end to another section (other than the start, to play
// again) means the story doesn't stop there any more, so its @end goes with the same change
export function linkEndsEnding(graph: StoryGraph, from: GraphNode, toId: string | undefined, text: string): TextEdit[] {
    const to = toId === undefined ? undefined : graph.nodes.find(n => n.id == toId);
    if (to && (to.kind != "section" || to.start)) return [];
    return endingRemovalEdits(graph, from, text);
}

// The section a passage is to be added to, from the section or one of its passages
export function sectionFor(graph: StoryGraph, node: GraphNode): GraphNode | undefined {
    const name = node.kind == "section" ? node.name : node.section;
    return graph.nodes.find(n => n.kind == "section" && n.name == name);
}

// The edits that add a passage to the section a node is in, at the end of the section, with a
// link to it from the node (placed as linkEdit places one). `text` is the section's file's text.
export function addPassageEdits(graph: StoryGraph, from: GraphNode, name: string, text: string, cursor?: Cursor): { file: string; edits: TextEdit[] } | undefined {
    const section = sectionFor(graph, from);
    if (!section) return undefined;
    const place = placeNewPassage(section);
    return { file: place.file, edits: linkThenHeaderEdits(text, addLink(graph, from, `[${name}]`, cursor), place.afterLine, `[${name}]:`) };
}

// The edits that add a section: after the section it's linked from or made near, in its file (see
// placeNewSection), with a link to it from `from` unless `link` is false (for a broken link that's
// there already). `file` is where it goes, and `text` that file's text.
export function newSectionEdits(graph: StoryGraph, name: string, where: { from?: GraphNode; near?: GraphNode; link?: boolean; file: string }, text: string, cursor?: Cursor): TextEdit[] {
    const place = placeNewSection(graph, where);
    const header = `[[${name}]]:`;
    if (where.from && where.link !== false && where.from.location.file == where.file) {
        return linkThenHeaderEdits(text, addLink(graph, where.from, `[[${name}]]`, cursor), place.afterLine, header);
    }
    return [insertHeaderEdit(text, place.afterLine, header)];
}

// The edit that adds a passage to a section, without a link to it (for a broken link to it)
export function newPassageEdit(section: GraphNode, name: string, text: string): { file: string; edit: TextEdit } {
    const place = placeNewPassage(section);
    return { file: place.file, edit: insertHeaderEdit(text, place.afterLine, `[${name}]:`) };
}

// What a broken link's marker would make: the section or passage it's missing, and where from. Not
// for an embed, or a name only known when the story runs, which have to be sorted out in the script.
export function missingTarget(graph: StoryGraph, edge: { kind: string; from: string; target?: string }): { kind: "section" | "passage"; name: string; from: GraphNode } | undefined {
    const from = graph.nodes.find(n => n.id == edge.from);
    const name = edge.target;
    if (!from || !name) return undefined;
    if (edge.kind == "passage-link") return { kind: "passage", name, from };
    if (edge.kind == "section-link" || edge.kind == "goto") return { kind: "section", name, from };
    return undefined;
}

// The positions after nodes are dropped on the map. Only sections and passages are kept.
export function movedPositions(graph: StoryGraph, positions: MapPositions | undefined, moves: { id: string; at: Point }[]): MapPositions {
    const keys = sectionKeys(graph);
    const byId = new Map(graph.nodes.map(n => [n.id, n]));
    let next = positions ?? emptyPositions();
    for (const { id, at } of moves) {
        const node = byId.get(id);
        if (node) next = withPosition(next, keys, node, at);
    }
    return next;
}
