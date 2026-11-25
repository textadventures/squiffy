// The messages between the story map's webview (main.ts) and the extension (client/map.ts)

import type { MapBoxSize, MapPositions } from "squiffy-compiler";
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
    | { type: "current"; id: string | null }
    // Select a node once a graph has it (a section or passage just made from the map)
    | { type: "select"; id: string }
    // Put the focus in the search box (Control or Command and F)
    | { type: "search" }
    // Where the player has been in the preview, in order, since the story last started
    | { type: "trace"; steps: TraceStep[] }
    // Lay the map out again, forgetting where boxes were moved to
    | { type: "relayout" }
    // Each section's and passage's own text in lower case, by id, while the map is searching:
    // sent after each graph until the search is cleared
    | { type: "texts"; texts: Record<string, string> }
    // The start of a section's or passage's text, answering an "excerpt" request
    | { type: "excerpt"; request: number; text: string };

export interface TraceStep {
    section: string;
    passage?: string;
}

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
    // A section's or passage's box was made bigger, or the usual size again (no size)
    | { type: "resize"; id: string; size?: MapBoxSize }
    // From the right-click menu (or F2 and Delete): a section or passage to rename, add a passage
    // to, run the preview from or start the story at, or sections and passages to delete
    | { type: "rename" | "addPassage" | "run" | "start" | "ending"; id: string }
    | { type: "delete"; ids: string[] }
    // Make a new section, its box at `at`: linked from `from` (a link dragged to empty space), or
    // near `near` in the script (the selected box, or the nearest one)
    | { type: "create"; at: Point; from?: string; near?: string }
    // Make what a broken link is missing: its marker's box is at `at`
    | { type: "createMissing"; edge: { from: string; kind: string; target?: string }; at?: Point }
    // Forget where boxes have been moved to (Lay out again)
    | { type: "relayout" }
    // The search box has something in it, so the map wants the story's text, or it's been cleared
    | { type: "searching"; on: boolean }
    // The start of a section's or passage's text, to show when the mouse is over its box and in
    // the selected box's details, as in the editor, and (`long`, as much as a big box can show)
    // on the box itself when zoomed in
    | { type: "excerpt"; request: number; id: string; long?: boolean };
