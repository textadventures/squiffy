// The story map's graph (#380), from the language service's story graph: sections as boxes, their
// passages as smaller boxes hanging under them, and broken links as markers saying what's
// missing. Each section's rank (its row on the map) is its distance in links from the start, so
// the map reads from the start at the top to the endings at the bottom. Sections that can't be
// reached from the start are a group of their own, to the side, ranked from wherever their own
// chains begin.
import type { GraphEdge, GraphEdgeKind, GraphNode, StoryGraph } from "squiffy-compiler/language-service";
import type { MapPositions } from "squiffy-compiler";
import { layeredLayout, type Layout, type MapEdge, type MapGraph, type MapNode } from "@textadventures/graph-map";

export interface StoryMapNode extends MapNode {
    kind: "section" | "passage" | "missing";
    // The section or passage, or for a "missing" marker, the broken link
    graphNode?: GraphNode;
    brokenEdge?: GraphEdge;
    rank?: number;
    // For a passage or a missing marker, the node it hangs under
    parent?: string;
    // 0 for what can be reached from the start, 1 for what can't
    group: number;
    // The section it's in: its own name, for a section
    section: string;
}

export interface StoryMapEdge extends MapEdge {
    kind: GraphEdgeKind;
    // Every link this stands for (links between the same two places are drawn once)
    edges: GraphEdge[];
    conditional: boolean;
    broken?: boolean;
}

export type StoryMap = MapGraph<StoryMapNode, StoryMapEdge>;

const sectionId = (name: string) => `section:${name}`;
const passageId = (section: string, name: string) => `passage:${section}/${name}`;

// Navigation: these change the section
const NAVIGATION = new Set<GraphEdgeKind>(["section-link", "goto", "script"]);

const SECTION_HEIGHT = 30;
const PASSAGE_HEIGHT = 22;

// A rough width for a label, without measuring text (which a worker or a test can't do)
function labelWidth(label: string, charWidth: number, min: number, max: number) {
    return Math.round(Math.min(max, Math.max(min, label.length * charWidth + 20)));
}

// What a section or passage is called on the map
export function nodeLabel(node: GraphNode): string {
    return node.detail ?? (node.name || "(untitled)");
}

export function buildStoryMap(graph: StoryGraph): StoryMap {
    const nodes: StoryMapNode[] = [];
    const byId = new Map<string, StoryMapNode>();
    const add = (node: StoryMapNode) => {
        nodes.push(node);
        byId.set(node.id, node);
    };
    // The master section ("") is part of every section rather than a place, so it isn't drawn
    const sectionOf = (n: GraphNode) => n.kind == "section" ? n.name : n.section!;
    const graphNodes = graph.nodes.filter(n => sectionOf(n) != "");
    const graphById = new Map(graph.nodes.map(n => [n.id, n]));

    // ---- Ranks ----
    const sections = graphNodes.filter(n => n.kind == "section");
    const sectionIds = new Map(sections.map(n => [n.name, n.id]));
    // Section to section navigation, from anything in the section
    const next = new Map<string, Set<string>>();
    const hasIncoming = new Set<string>();
    for (const edge of graph.edges) {
        if (!NAVIGATION.has(edge.kind) || !edge.to) continue;
        const from = graphById.get(edge.from), to = graphById.get(edge.to);
        if (!from || !to) continue;
        const a = sectionIds.get(sectionOf(from)), b = sectionIds.get(sectionOf(to));
        if (!a || !b || a == b) continue;
        let set = next.get(a);
        if (!set) next.set(a, set = new Set());
        set.add(b);
        hasIncoming.add(b);
    }
    const rank = new Map<string, number>();
    const bfs = (roots: string[]) => {
        const queue = roots.filter(r => !rank.has(r));
        for (const r of queue) rank.set(r, 0);
        for (let i = 0; i < queue.length; i++) {
            const id = queue[i];
            for (const n of next.get(id) ?? []) {
                if (rank.has(n)) continue;
                rank.set(n, rank.get(id)! + 1);
                queue.push(n);
            }
        }
    };
    const start = sections.find(n => n.start);
    if (start) bfs([start.id]);
    // What the start doesn't lead to: from where its chains begin, then from whatever's left
    // (sections in loops), in the order they're written
    bfs(sections.filter(n => !rank.has(n.id) && !hasIncoming.has(n.id)).map(n => n.id));
    for (const n of sections) bfs([n.id]);
    // Reachable, by the map's reckoning: led to from the start
    const fromStart = new Set<string>();
    if (start) {
        const queue = [start.id];
        fromStart.add(start.id);
        for (let i = 0; i < queue.length; i++) {
            for (const n of next.get(queue[i]) ?? []) {
                if (!fromStart.has(n)) {
                    fromStart.add(n);
                    queue.push(n);
                }
            }
        }
    }

    // ---- Nodes ----
    for (const n of graphNodes) {
        const label = nodeLabel(n);
        const section = sectionOf(n);
        const sectionId = sectionIds.get(section)!;
        const classes: string[] = [n.kind];
        if (n.start) classes.push("start");
        if (n.ending) classes.push("ending");
        // As in the diagnostics: a section that can't be reached isn't also called a dead end
        if (n.deadEnd && n.reachable) classes.push("dead-end");
        if (!n.reachable) classes.push("unreachable");
        if (n.unknownExits) classes.push("unknown-exits");
        if (n.detail) classes.push("unnamed");
        add({
            id: n.id,
            kind: n.kind,
            label,
            width: n.kind == "section" ? labelWidth(label, 7.4, 60, 190) + (n.start ? 12 : 0) : labelWidth(label, 6.8, 36, 150),
            height: n.kind == "section" ? SECTION_HEIGHT : PASSAGE_HEIGHT,
            class: classes.join(" "),
            graphNode: n,
            ...(n.kind == "section" ? { rank: rank.get(n.id) } : { parent: sectionId }),
            group: fromStart.has(sectionId) || !start ? 0 : 1,
            section,
        });
    }

    // ---- Edges ----
    const merged = new Map<string, StoryMapEdge>();
    for (const edge of graph.edges) {
        const from = byId.get(edge.from);
        if (!from) continue;
        let to = edge.to;
        let broken = false;
        if (to === undefined) {
            // A broken link gets a marker saying what it links to
            if (edge.target === undefined) continue;
            to = `missing:${edge.from}>${edge.kind == "embed" ? "embed" : "link"}:${edge.target}`;
            if (!byId.has(to)) {
                const label = edge.target || "(nothing)";
                add({
                    id: to,
                    kind: "missing",
                    label,
                    width: labelWidth(label, 6.5, 32, 140),
                    height: PASSAGE_HEIGHT,
                    class: "missing",
                    brokenEdge: edge,
                    parent: sectionIds.get(from.section),
                    group: from.group,
                    section: from.section,
                    decoration: true,
                });
            }
            broken = true;
        }
        if (!byId.has(to) || to == edge.from) continue;
        const key = `${edge.from}>${to}>${edge.kind}`;
        const existing = merged.get(key);
        if (existing) {
            existing.edges.push(edge);
            existing.conditional &&= edge.conditional;
            continue;
        }
        merged.set(key, { id: key, from: edge.from, to, kind: edge.kind, edges: [edge], conditional: edge.conditional, ...(broken ? { broken } : {}) });
    }
    const edges = [...merged.values()];
    for (const edge of edges) {
        edge.class = [`edge-${edge.kind}`, edge.conditional ? "conditional" : "", edge.broken ? "broken" : ""].filter(Boolean).join(" ");
        edge.title = edgeTitle(edge, byId);
    }

    // ---- Descriptions, for screen readers ----
    const outgoing = new Map<string, StoryMapEdge[]>();
    const incoming = new Map<string, StoryMapEdge[]>();
    for (const edge of edges) {
        (outgoing.get(edge.from) ?? outgoing.set(edge.from, []).get(edge.from)!).push(edge);
        (incoming.get(edge.to) ?? incoming.set(edge.to, []).get(edge.to)!).push(edge);
    }
    for (const node of nodes) {
        node.description = describe(node, outgoing.get(node.id) ?? [], incoming.get(node.id) ?? [], byId);
    }
    return { nodes, edges };
}

const KIND_NAMES: Record<GraphEdgeKind, string> = {
    "section-link": "Link",
    "passage-link": "Passage link",
    embed: "Embed",
    goto: "Go to",
    script: "squiffy.story.go",
};

function edgeTitle(edge: StoryMapEdge, byId: Map<string, StoryMapNode>): string {
    const to = byId.get(edge.to)!;
    const texts = [...new Set(edge.edges.map(e => e.text).filter(Boolean))];
    const target = edge.broken ? `${to.label} (doesn't exist)` : to.label;
    return `${KIND_NAMES[edge.kind]}${edge.conditional ? " (conditional)" : ""} to ${target}${texts.length ? `: "${texts.join("\", \"")}"` : ""}`;
}

function describe(node: StoryMapNode, out: StoryMapEdge[], into: StoryMapEdge[], byId: Map<string, StoryMapNode>): string {
    if (node.kind == "missing") return `Missing: ${node.label}. Nothing in the story is called that.`;
    const g = node.graphNode!;
    const parts = [`${node.kind == "section" ? "Section" : `Passage in ${byId.get(node.parent!)?.label ?? node.section}`} ${node.label}.`];
    if (g.start) parts.push("The story starts here.");
    if (g.ending) parts.push("An ending.");
    if (g.deadEnd && g.reachable) parts.push("A dead end: no way out.");
    if (!g.reachable) parts.push("Can't be reached from the start.");
    const names = (list: StoryMapEdge[], end: "to" | "from") => [...new Set(list.map(e => byId.get(e[end])!.label))].join(", ");
    if (out.length) parts.push(`Links to ${names(out, "to")}.`);
    if (into.length) parts.push(`Linked from ${names(into, "from")}.`);
    return parts.join(" ");
}

// The layout: rows by distance from the start, passages under their sections
export function storyMapLayout(): Layout<StoryMapNode, StoryMapEdge> {
    return layeredLayout<StoryMapNode, StoryMapEdge>({
        rank: n => n.rank,
        parent: n => n.parent,
        group: n => n.group,
        edgeStrength: e => e.kind == "section-link" || e.kind == "goto" ? 0.6 : e.kind == "script" ? 0.4 : 0.2,
        rowGap: 90,
        columnGap: 28,
    });
}

// ---- Positions the author has chosen, as saved in squiffy.json ----

export interface Point {
    x: number;
    y: number;
}

export const emptyPositions = (): MapPositions => ({ sections: {}, passages: {} });

// The saved positions, by node id
export function pinnedPositions(positions: MapPositions | undefined): Map<string, Point> {
    const pinned = new Map<string, Point>();
    if (!positions) return pinned;
    for (const [name, [x, y]] of Object.entries(positions.sections)) pinned.set(sectionId(name), { x, y });
    for (const [section, byName] of Object.entries(positions.passages)) {
        for (const [name, [x, y]] of Object.entries(byName)) pinned.set(passageId(section, name), { x, y });
    }
    return pinned;
}

// A copy of the positions with one node's changed (or removed, with undefined). Only sections and
// passages have positions saved.
export function withPosition(positions: MapPositions | undefined, node: Pick<GraphNode, "kind" | "name" | "section">, at: Point | undefined): MapPositions {
    const next: MapPositions = {
        sections: { ...positions?.sections },
        passages: Object.fromEntries(Object.entries(positions?.passages ?? {}).map(([s, byName]) => [s, { ...byName }])),
    };
    const value: [number, number] | undefined = at && [Math.round(at.x), Math.round(at.y)];
    if (node.kind == "section") {
        if (value) next.sections[node.name] = value;
        else delete next.sections[node.name];
    } else {
        const byName = next.passages[node.section!] ??= {};
        if (value) byName[node.name] = value;
        else delete byName[node.name];
        if (!Object.keys(byName).length) delete next.passages[node.section!];
    }
    return next;
}

// Sections and passages that have been renamed between two versions of the story: one that's
// gone and one that's new, of the same kind, whose headers are on the same line of the same
// file. That catches a rename however it's done, from the map, F2, or typing over the name.
export function findRenames(before: StoryGraph, after: StoryGraph): [GraphNode, GraphNode][] {
    const afterIds = new Set(after.nodes.map(n => n.id));
    const beforeIds = new Set(before.nodes.map(n => n.id));
    const place = (n: GraphNode) => `${n.kind}\u0000${n.location.file}\u0000${n.location.range.start.line}`;
    const gone = new Map<string, GraphNode[]>();
    for (const n of before.nodes) {
        if (afterIds.has(n.id)) continue;
        const key = place(n);
        gone.set(key, [...gone.get(key) ?? [], n]);
    }
    const renames: [GraphNode, GraphNode][] = [];
    for (const n of after.nodes) {
        if (beforeIds.has(n.id)) continue;
        const candidates = gone.get(place(n));
        if (candidates?.length == 1) {
            renames.push([candidates[0], n]);
            gone.delete(place(n));
        }
    }
    return renames;
}

// The saved positions after renames, or undefined if none of them had a saved position. A
// renamed section's passages keep theirs too.
export function renamePositions(positions: MapPositions | undefined, renames: [GraphNode, GraphNode][]): MapPositions | undefined {
    if (!positions) return undefined;
    let changed = false;
    const next: MapPositions = {
        sections: { ...positions.sections },
        passages: Object.fromEntries(Object.entries(positions.passages).map(([s, byName]) => [s, { ...byName }])),
    };
    // Sections first, as a renamed section's passages are renamed too
    const movedSections = new Map<string, string>();
    for (const [from, to] of renames) {
        if (from.kind != "section") continue;
        movedSections.set(from.name, to.name);
        const at = next.sections[from.name];
        if (at) {
            delete next.sections[from.name];
            next.sections[to.name] = at;
            changed = true;
        }
        const passages = next.passages[from.name];
        if (passages) {
            delete next.passages[from.name];
            next.passages[to.name] = passages;
            changed = true;
        }
    }
    for (const [from, to] of renames) {
        if (from.kind != "passage") continue;
        const byName = next.passages[movedSections.get(from.section!) ?? from.section!];
        const at = byName?.[from.name];
        if (at) {
            delete byName[from.name];
            (next.passages[to.section!] ??= {})[to.name] = at;
            changed = true;
        }
    }
    return changed ? next : undefined;
}

// ---- Editing from the map ----

// What to write in `from` to link to `to`, or why it can't: a section link to a section with a
// name of its own, or a passage link to a passage in the same section.
export function linkTo(from: GraphNode, to: GraphNode): { text: string } | { error: string } {
    const fromSection = from.kind == "section" ? from.name : from.section!;
    if (to.kind == "section") {
        if (to.detail) return { error: "That section doesn't have a name of its own to link to." };
        return { text: `[[${to.name}]]` };
    }
    if (to.section != fromSection) return { error: "A passage can only be linked to from its own section." };
    if (to.name.startsWith("@")) return { error: "Passages whose names start with @ run on their own, so they aren't linked to." };
    return { text: `[${to.name}]` };
}

// Why a name can't be used for a new section, if it can't
export function checkSectionName(name: string, graph: StoryGraph): string | undefined {
    if (!name || name != name.trim()) return "A name can't be empty or start or end with a space.";
    if (/[[\]\n,"]/.test(name)) return "A name can't contain [, ], a comma or a double quote.";
    if (name.startsWith("_") || name.startsWith("@")) return "A name can't start with _ or @.";
    if (graph.nodes.some(n => n.kind == "section" && n.name == name)) return `There's already a section called '${name}'.`;
    return undefined;
}

// The section or passage a line of a file is in: the last header at or before it
export function nodeAtLine(graph: StoryGraph, file: string, line: number): GraphNode | undefined {
    let best: GraphNode | undefined;
    for (const n of graph.nodes) {
        if (n.location.file != file || n.name == "" || n.section == "") continue;
        const start = n.location.range.start.line;
        if (start <= line && (!best || start >= best.location.range.start.line)) best = n;
    }
    return best;
}
