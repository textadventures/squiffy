// What the Squiffy sidebar's Sections view shows (#616): the story's sections and passages, from
// every file, marked as the story map marks them. Kept apart from the view (sections-view.ts), as
// it has no need of VS Code, so it can be tested.

import type { GraphNode, StoryGraph } from "squiffy-compiler/language-service";
import { nodeLabel, reachNote } from "@textadventures/squiffy-app/story-map";

// What's worth showing about a section or passage, besides its name, most important first
export type Mark = "dead-end" | "unreachable" | "start" | "ending" | "test" | "embedded";

const MARK_NAMES: Record<Mark, string> = {
    "dead-end": "dead end",
    unreachable: "unreachable",
    start: "start",
    ending: "ending",
    test: "test",
    embedded: "embedded",
};

export type SectionsItem = FileItem | NodeItem;

// A story file, when there's more than one, with its sections
export interface FileItem {
    kind: "file";
    id: string;
    file: string;
    children: NodeItem[];
}

export interface NodeItem {
    kind: "section" | "passage";
    id: string;
    node: GraphNode;
    label: string;
    // The master section, whose content is part of every section: it isn't a place in the story,
    // so it has no marks, and the preview can't start there
    master: boolean;
    marks: Mark[];
    // The marks, in words, beside the name
    description: string;
    tooltip: string;
    children: NodeItem[];
}

// The items at the top of the view: the story's sections, or if it's in more than one file, its
// files, the main file first, with their sections. Each in the order they're written in.
export function sectionsTree(graph: StoryGraph, mainFile: string): SectionsItem[] {
    const passages = new Map<string, GraphNode[]>();
    for (const node of graph.nodes) {
        if (node.kind != "passage") continue;
        const list = passages.get(node.section!) ?? [];
        list.push(node);
        passages.set(node.section!, list);
    }
    const byFile = new Map<string, NodeItem[]>();
    for (const node of graph.nodes) {
        if (node.kind != "section") continue;
        const item = nodeItem(node, graph, (passages.get(node.name) ?? []).map(p => nodeItem(p, graph, [])));
        const list = byFile.get(node.location.file) ?? [];
        list.push(item);
        byFile.set(node.location.file, list);
    }
    if (byFile.size <= 1) return [...byFile.values()].flat();
    const files = [...byFile.keys()].sort((a, b) => a == mainFile ? -1 : b == mainFile ? 1 : a.localeCompare(b));
    return files.map(file => ({ kind: "file", id: `file:${file}`, file, children: byFile.get(file)! }));
}

function nodeItem(node: GraphNode, graph: StoryGraph, children: NodeItem[]): NodeItem {
    const master = node.kind == "section" ? node.name == "" : node.section == "";
    const marks = master ? [] : nodeMarks(node, graph);
    const label = node.kind == "section" && node.name == "" ? "Master section" : nodeLabel(node);
    return {
        kind: node.kind,
        id: node.id,
        node,
        label,
        master,
        marks,
        description: master && node.kind == "section" ? "part of every section" : marks.map(m => MARK_NAMES[m]).join(", "),
        tooltip: master ? masterTooltip(node) : nodeTooltip(label, node, graph),
        children,
    };
}

// As the story map marks them (app/src/lib/story-map.ts)
export function nodeMarks(node: GraphNode, graph: StoryGraph): Mark[] {
    const marks: Mark[] = [];
    // As in the diagnostics: a section that can't be reached isn't also called a dead end
    if (node.deadEnd && node.reachable) marks.push("dead-end");
    if (!node.reachable && !node.embedded && !node.test && graph.reachabilityKnown) marks.push("unreachable");
    if (node.start) marks.push("start");
    if (node.ending) marks.push("ending");
    if (node.test) marks.push("test");
    if (node.embedded) marks.push("embedded");
    return marks;
}

function nodeTooltip(label: string, node: GraphNode, graph: StoryGraph): string {
    const lines = [node.kind == "section" ? `Section ${label}` : `Passage ${label}, in ${node.section ? node.section : "the master section"}`];
    if (node.start) lines.push("The story starts here.");
    if (node.ending) lines.push("An ending (@end).");
    if (node.test) lines.push("For testing the story (@test): players can't get here.");
    if (node.deadEnd && node.reachable) lines.push("A dead end: no way out, and not an ending.");
    if (node.unknownExits) lines.push("Can go somewhere that isn't known until the story is played: a link or {{goto}} worked out as it's played, or JavaScript.");
    // A section for testing is reached from the start of a test rather than of the story
    const reach = node.test ? "" : reachNote(node, graph);
    if (reach) lines.push(reach);
    return lines.join("\n");
}

function masterTooltip(node: GraphNode): string {
    return node.kind == "section"
        ? "The master section: its text and passages are part of every section."
        : `Passage ${nodeLabel(node)}, in the master section, which every section has.`;
}

// The parent of every item that has one, for revealing an item in the tree
export function parentsOf(items: SectionsItem[]): Map<string, SectionsItem> {
    const parents = new Map<string, SectionsItem>();
    const visit = (item: SectionsItem) => {
        for (const child of item.children) {
            parents.set(child.id, item);
            visit(child);
        }
    };
    items.forEach(visit);
    return parents;
}

// Where the preview starts for a section or passage, or undefined for the master section's
export function startAt(item: NodeItem): { section: string; passage?: string } | undefined {
    if (item.master) return undefined;
    return item.kind == "passage" ? { section: item.node.section!, passage: item.node.name } : { section: item.node.name };
}
