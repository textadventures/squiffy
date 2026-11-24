// What editing on the story map does to the story, as the editor's map does it
// (app/src/routes/edit/+page.svelte). Kept apart from VS Code's API, to be tested.

import type { MapPositions } from "squiffy-compiler";
import type { Position, StoryGraph, TextEdit } from "squiffy-compiler/language-service";
import { emptyPositions, linkTo, nodeAtLine, sectionKeys, withPosition } from "@textadventures/squiffy-app/story-map";
import type { Point } from "../map/messages.js";

// Where the cursor is: a file (as a path from the story's folder) and a position in it
export interface Cursor {
    file: string;
    position: Position;
}

// The edit that adds a link from one node to another: at the cursor, if it's in the node the link
// is from (below its header), or else after the node's own text. Or why there can't be a link.
export function linkEdit(graph: StoryGraph, fromId: string, toId: string, cursor?: Cursor): { file: string; edit: TextEdit } | { error: string } {
    const from = graph.nodes.find(n => n.id == fromId), to = graph.nodes.find(n => n.id == toId);
    if (!from || !to) return { error: "The story has changed. Try again." };
    const link = linkTo(from, to);
    if ("error" in link) return link;
    const file = from.location.file;
    if (cursor?.file == file) {
        const at = cursor.position;
        if (nodeAtLine(graph, file, at.line)?.id == from.id && at.line > from.location.range.start.line) {
            return { file, edit: { range: { start: at, end: at }, newText: link.text } };
        }
    }
    const at = from.contentEnd;
    const headerOnly = at.line == from.location.range.start.line;
    return { file, edit: { range: { start: at, end: at }, newText: `${headerOnly ? "\n" : "\n\n"}${link.text}` } };
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
