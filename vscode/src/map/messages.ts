// The messages between the story map's webview (main.ts) and the extension (client/map.ts)

import type { MapPositions } from "squiffy-compiler";
import type { Location, StoryGraph } from "squiffy-compiler/language-service";

export interface Point {
    x: number;
    y: number;
}

export type ToMap =
    // The story's graph, and where the author has put things on the map. `renamed` are the nodes
    // whose ids have changed since the last graph (renamed, say), which keep their places.
    | { type: "graph"; graph: StoryGraph; positions?: MapPositions; renamed: [string, string][] }
    // The section or passage the cursor is in, if it's in the story
    | { type: "current"; id: string | null };

export type FromMap =
    // The page has loaded and wants the graph
    | { type: "ready" }
    // Go to a place in the story: a section, a passage, or a link. With focus, the editor takes
    // the focus (Enter, or a double-click); without, the map keeps it (a click).
    | { type: "goto"; location: Location; focus: boolean }
    // A link was dragged from one node to another
    | { type: "link"; from: string; to: string }
    // Nodes were dropped somewhere, and are now pinned there
    | { type: "move"; moves: { id: string; at: Point }[] }
    // From the right-click menu (or F2 and Delete): a section or passage to rename, add a passage
    // to, run the preview from or start the story at, or sections and passages to delete
    | { type: "rename" | "addPassage" | "run" | "start"; id: string }
    | { type: "delete"; ids: string[] };
