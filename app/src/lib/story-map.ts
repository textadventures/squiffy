// The story map's graph (#380), from the language service's story graph: sections as boxes, their
// passages as smaller boxes hanging under them, and broken links as markers saying what's
// missing. Each section's rank (its row on the map) is the longest way to it
// from the start, leaving out links that go back round a loop, so the links point down the map,
// from the start at the top to the endings at the bottom. Embeds count, as their links show where
// they're embedded. Sections that can't be reached from the start are a group of their own, to the
// side, ranked from wherever their own chains begin.
import type { GraphEdge, GraphEdgeKind, GraphNode, Location, StoryGraph } from "squiffy-compiler/language-service";
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
    // "auto" ties a section to a passage that runs on its own, such as @last, which nothing
    // links to
    kind: GraphEdgeKind | "auto";
    // Every link this stands for (links between the same two places are drawn once). None for
    // "auto".
    edges: GraphEdge[];
    conditional: boolean;
    broken?: boolean;
    // Where to go in the script: for "auto", the passage's header
    location?: Location;
}

// Passages that run without being linked to: @last, @1, @2... and the passage called "", which
// runs with every other passage in its section
const runsOnItsOwn = (name: string) => name == "" || name.startsWith("@");

export type StoryMap = MapGraph<StoryMapNode, StoryMapEdge>;

const sectionId = (name: string) => `section:${name}`;

// What the map's rows follow: navigation, and embeds, whose links show where they're embedded
const NAVIGATION = new Set<GraphEdgeKind>(["section-link", "goto", "script", "embed"]);

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
    // Section to section navigation (and embedding), from anything in the section
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
    // Rows by the longest path from the start, once the links that go back round loops are set
    // aside, so that every other link points down the map. (The shortest path would put a
    // section that many choices lead to, such as "next round", in the same row as the choices.)
    const start = sections.find(n => n.start);
    const roots = [
        ...(start ? [start.id] : []),
        // Then what the start doesn't lead to: from where its chains begin, then whatever's left
        // (sections in loops), in the order they're written
        ...sections.filter(n => !hasIncoming.has(n.id)).map(n => n.id),
        ...sections.map(n => n.id),
    ];
    // Links back to a section that's on the way to them, found by walking depth first
    const back = new Set<string>();
    const visited = new Set<string>();
    const onPath = new Set<string>();
    for (const root of roots) {
        if (visited.has(root)) continue;
        const stack: { id: string; children: Iterator<string> }[] = [{ id: root, children: (next.get(root) ?? new Set<string>()).values() }];
        visited.add(root);
        onPath.add(root);
        while (stack.length) {
            const top = stack[stack.length - 1];
            const child = top.children.next();
            if (child.done) {
                onPath.delete(top.id);
                stack.pop();
                continue;
            }
            const id = child.value;
            if (onPath.has(id)) back.add(`${top.id}\u0000${id}`);
            else if (!visited.has(id)) {
                visited.add(id);
                onPath.add(id);
                stack.push({ id, children: (next.get(id) ?? new Set<string>()).values() });
            }
        }
    }
    // Longest paths over the links that remain, in an order where every section comes after
    // everything that leads to it
    const forward = new Map<string, string[]>();
    const waiting = new Map<string, number>(sections.map(n => [n.id, 0]));
    for (const [from, tos] of next) {
        for (const to of tos) {
            if (back.has(`${from}\u0000${to}`)) continue;
            (forward.get(from) ?? forward.set(from, []).get(from)!).push(to);
            waiting.set(to, waiting.get(to)! + 1);
        }
    }
    const rank = new Map<string, number>();
    const ready = roots.filter((id, i) => roots.indexOf(id) == i && waiting.get(id) == 0);
    for (const id of ready) rank.set(id, 0);
    for (let i = 0; i < ready.length; i++) {
        const id = ready[i];
        for (const to of forward.get(id) ?? []) {
            rank.set(to, Math.max(rank.get(to) ?? 0, rank.get(id)! + 1));
            const left = waiting.get(to)! - 1;
            waiting.set(to, left);
            if (left == 0) ready.push(to);
        }
    }
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
        if (!n.reachable && !n.embedded) classes.push("unreachable");
        if (n.embedded) classes.push("embedded");
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
    // Passages that run on their own are tied to their sections, as nothing links to them
    for (const n of nodes) {
        if (n.kind != "passage" || !n.parent || !runsOnItsOwn(n.graphNode!.name)) continue;
        edges.push({ id: `${n.parent}>${n.id}>auto`, from: n.parent, to: n.id, kind: "auto", edges: [], conditional: false, location: n.graphNode!.location });
    }
    for (const edge of edges) {
        edge.class = [`edge-${edge.kind}`, edge.conditional ? "conditional" : "", edge.broken ? "broken" : ""].filter(Boolean).join(" ");
        edge.title = edgeTitle(edge, byId);
    }

    // ---- Descriptions, for screen readers ----
    const outgoing = new Map<string, StoryMapEdge[]>();
    const incoming = new Map<string, StoryMapEdge[]>();
    for (const edge of edges) {
        if (edge.kind == "auto") continue;
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
    if (edge.kind == "auto") {
        const name = byId.get(edge.to)!.label;
        return name == "@last" ? "@last runs once every other passage in the section has been clicked"
            : /^@\d+$/.test(name) ? `${name} runs when that many passages in the section have been clicked`
            : `${name} runs on its own`;
    }
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
    if (node.kind == "passage" && runsOnItsOwn(g.name)) parts.push("Runs on its own, without a link.");
    if (g.ending) parts.push("An ending.");
    if (g.deadEnd && g.reachable) parts.push("A dead end: no way out.");
    if (g.embedded) parts.push("Shown inside other sections.");
    else if (!g.reachable) parts.push("Can't be reached from the start.");
    const names = (list: StoryMapEdge[], end: "to" | "from") => [...new Set(list.map(e => byId.get(e[end])!.label))].join(", ");
    if (out.length) parts.push(`Links to ${names(out, "to")}.`);
    if (into.length) parts.push(`Linked from ${names(into, "from")}.`);
    return parts.join(" ");
}

// The layout: rows by the longest way from the start, passages under their sections
export function storyMapLayout(): Layout<StoryMapNode, StoryMapEdge> {
    return layeredLayout<StoryMapNode, StoryMapEdge>({
        rank: n => n.rank,
        parent: n => n.parent,
        group: n => n.group,
        edgeStrength: e => e.kind == "section-link" || e.kind == "goto" ? 0.6 : e.kind == "script" ? 0.4 : 0.2,
        rowGap: 90,
        columnGap: 28,
        sweeps: 8,
    });
}

// ---- Positions the author has chosen, as saved in squiffy.json ----

export interface Point {
    x: number;
    y: number;
}

export const emptyPositions = (): MapPositions => ({ sections: {}, passages: {} });

// What a section's position is saved under: its name, or for a section without a name of its
// own, what the map calls it: "+++Day Two", "---" or "(Start)". The name the story gives such a
// section (_continue1 and so on) changes whenever another is added above it, but this doesn't. If
// two have the same label, the section before them tells them apart ("--- after cave"), and if
// that's not enough, their order does ("--- after cave (2)").
export function sectionKeys(graph: StoryGraph): Map<string, string> {
    const keys = new Map<string, string>();
    const sections = graph.nodes.filter(n => n.kind == "section" && n.name != "");
    const labelCount = new Map<string, number>();
    for (const n of sections) if (n.detail) labelCount.set(n.detail, (labelCount.get(n.detail) ?? 0) + 1);
    let previous = "";
    const candidates = new Map<string, string>();
    for (const n of sections) {
        if (!n.detail) {
            keys.set(n.name, n.name);
            previous = n.name;
            continue;
        }
        candidates.set(n.name, labelCount.get(n.detail) == 1 ? n.detail : previous ? `${n.detail} after ${previous}` : n.detail);
    }
    const seen = new Map<string, number>();
    const total = new Map<string, number>();
    for (const key of candidates.values()) total.set(key, (total.get(key) ?? 0) + 1);
    for (const [name, key] of candidates) {
        const n = (seen.get(key) ?? 0) + 1;
        seen.set(key, n);
        keys.set(name, total.get(key)! > 1 && n > 1 ? `${key} (${n})` : key);
    }
    return keys;
}

// The saved positions, by node id
export function pinnedPositions(positions: MapPositions | undefined, graph: StoryGraph | null): Map<string, Point> {
    const pinned = new Map<string, Point>();
    if (!positions || !graph) return pinned;
    for (const [name, key] of sectionKeys(graph)) {
        const at = positions.sections[key];
        if (at) pinned.set(sectionId(name), { x: at[0], y: at[1] });
    }
    const keys = sectionKeys(graph);
    for (const n of graph.nodes) {
        if (n.kind != "passage") continue;
        const key = keys.get(n.section!);
        const at = key === undefined ? undefined : positions.passages[key]?.[n.name];
        if (at) pinned.set(n.id, { x: at[0], y: at[1] });
    }
    return pinned;
}

// A copy of the positions with one node's changed (or removed, with undefined). Only sections and
// passages have positions saved.
export function withPosition(positions: MapPositions | undefined, keys: Map<string, string>, node: Pick<GraphNode, "kind" | "name" | "section">, at: Point | undefined): MapPositions {
    const next: MapPositions = {
        sections: { ...positions?.sections },
        passages: Object.fromEntries(Object.entries(positions?.passages ?? {}).map(([s, byName]) => [s, { ...byName }])),
    };
    const value: [number, number] | undefined = at && [Math.round(at.x), Math.round(at.y)];
    if (node.kind == "section") {
        const key = keys.get(node.name) ?? node.name;
        if (value) next.sections[key] = value;
        else delete next.sections[key];
    } else {
        const key = keys.get(node.section!) ?? node.section!;
        const byName = next.passages[key] ??= {};
        if (value) byName[node.name] = value;
        else delete byName[node.name];
        if (!Object.keys(byName).length) delete next.passages[key];
    }
    return next;
}

// Sections and passages that have been renamed between two versions of the story: one that's
// gone and one that's new, of the same kind, whose headers are on the same line of the same
// file. That catches a rename however it's done, from the map, F2, or typing over the name.
export function findRenames(before: StoryGraph, after: StoryGraph): [GraphNode, GraphNode][] {
    const afterIds = new Set(after.nodes.map(n => n.id));
    const beforeIds = new Set(before.nodes.map(n => n.id));
    // One whose position key is in both versions has only moved (e.g. "+++Day Two" becoming
    // _continue2 when a section's added above it), even if another has landed on its line
    const beforeKeys = nodeKeys(before), afterKeys = nodeKeys(after);
    const stillThere = new Set(afterKeys.values()), wasThere = new Set(beforeKeys.values());
    const place = (n: GraphNode) => `${n.kind}\u0000${n.location.file}\u0000${n.location.range.start.line}`;
    const gone = new Map<string, GraphNode[]>();
    for (const n of before.nodes) {
        if (afterIds.has(n.id) || stillThere.has(beforeKeys.get(n.id)!)) continue;
        const key = place(n);
        gone.set(key, [...gone.get(key) ?? [], n]);
    }
    const renames: [GraphNode, GraphNode][] = [];
    for (const n of after.nodes) {
        if (beforeIds.has(n.id) || wasThere.has(afterKeys.get(n.id)!)) continue;
        const candidates = gone.get(place(n));
        if (candidates?.length == 1) {
            renames.push([candidates[0], n]);
            gone.delete(place(n));
        }
    }
    return renames;
}

// Every section's and passage's position key ("section key" or "section key/passage name"),
// by node id
function nodeKeys(graph: StoryGraph): Map<string, string> {
    const keys = sectionKeys(graph);
    const result = new Map<string, string>();
    for (const n of graph.nodes) {
        const section = keys.get(n.kind == "section" ? n.name : n.section!);
        if (section === undefined) continue;
        result.set(n.id, n.kind == "section" ? section : `${section}\u0000${n.name}`);
    }
    return result;
}

// The nodes that are the same section or passage before and after an edit, though their ids
// differ: renamed ones (see findRenames), and ones without a name of their own whose story names
// shifted, e.g. "+++Day Two" going from _continue2 to _continue3 when a section's added above it.
// The map moves each one's place to its new id.
export function movedNodes(before: StoryGraph, after: StoryGraph): [string, string][] {
    const pairs = new Map<string, string>(findRenames(before, after).map(([a, b]) => [a.id, b.id]));
    const byKey = new Map([...nodeKeys(after)].map(([id, key]) => [key, id]));
    for (const [id, key] of nodeKeys(before)) {
        const now = byKey.get(key);
        if (now && now != id && !pairs.has(id)) pairs.set(id, now);
    }
    return [...pairs];
}

// The saved positions after an edit, or undefined if none changed: a section or passage that's
// been renamed, or a section without a name of its own whose +++ text changed, keeps its place.
// A renamed section's passages keep theirs too.
export function renamePositions(positions: MapPositions | undefined, before: StoryGraph, after: StoryGraph): MapPositions | undefined {
    if (!positions) return undefined;
    const beforeKeys = nodeKeys(before), afterKeys = nodeKeys(after);
    const afterById = new Map(after.nodes.map(n => [n.id, n]));
    // The same node: renamed, or with the same id and its header on the same line
    const pairs: [GraphNode, GraphNode][] = [...findRenames(before, after)];
    for (const n of before.nodes) {
        const same = afterById.get(n.id);
        if (same && same.location.file == n.location.file && same.location.range.start.line == n.location.range.start.line) pairs.push([n, same]);
    }
    let changed = false;
    const next: MapPositions = {
        sections: { ...positions.sections },
        passages: Object.fromEntries(Object.entries(positions.passages).map(([s, byName]) => [s, { ...byName }])),
    };
    const split = (key: string) => key.split("\u0000") as [string, string?];
    // Sections first, as a renamed section's passages are renamed too
    for (const [from, to] of pairs) {
        if (from.kind != "section") continue;
        const a = beforeKeys.get(from.id), b = afterKeys.get(to.id);
        if (a === undefined || b === undefined || a == b) continue;
        if (next.sections[a]) {
            next.sections[b] = next.sections[a];
            delete next.sections[a];
            changed = true;
        }
        if (next.passages[a]) {
            next.passages[b] = { ...next.passages[b], ...next.passages[a] };
            delete next.passages[a];
            changed = true;
        }
    }
    for (const [from, to] of pairs) {
        if (from.kind != "passage") continue;
        const a = beforeKeys.get(from.id), b = afterKeys.get(to.id);
        if (a === undefined || b === undefined || a == b) continue;
        const [aSection, aName] = split(a), [bSection, bName] = split(b);
        // Its section's move has already brought it along
        const byName = next.passages[aSection] ?? next.passages[bSection];
        const at = byName?.[aName!];
        if (at) {
            delete byName[aName!];
            (next.passages[bSection] ??= {})[bName!] = at;
            changed = true;
        }
    }
    for (const [key, byName] of Object.entries(next.passages)) if (!Object.keys(byName).length) delete next.passages[key];
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
