// The story map's graph (#380), from the language service's story graph: sections as boxes, their
// passages as smaller boxes hanging under them, and broken links as markers saying what's
// missing. Each section's rank (its row on the map) is the longest way to it
// from the start, leaving out links that go back round a loop, so the links point down the map,
// from the start at the top to the endings at the bottom. Embeds count, as their links show where
// they're embedded. Sections that can't be reached from the start are a group of their own, to the
// side, ranked from wherever their own chains begin.
import type { DocumentSymbol, GraphEdge, GraphEdgeKind, GraphNode, Location, StoryGraph } from "squiffy-compiler/language-service";
import type { MapBoxSize, MapPositions, MapSizes } from "squiffy-compiler";
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
    // If the author has made its box bigger (#681)
    size?: MapBoxSize;
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

// Tall enough for the start of a section's text under its name when zoomed in (#681)
const SECTION_HEIGHT = 40;
const PASSAGE_HEIGHT = 22;

// Zooms from which boxes show the start of their text (#681): a section of the usual size two
// lines of it from the first zoom in from 100%, then three smaller lines, and a passage one, from
// the third. A box the author has made bigger shows it at any zoom.
export const DETAIL_ZOOMS = [1.2, 1.8];

// The sizes a box can be, for its right-click menu, with undefined for the usual size
export const BOX_SIZE_CHOICES: [MapBoxSize | undefined, string][] = [[undefined, "Box: usual size"], ["wide", "Box: wide"], ["tall", "Box: tall"], ["large", "Box: large"]];

// How much of a section's or passage's text to show on its box: about as much as the largest box
// has room for
export const BOX_EXCERPT = 900;

// A box's size, which the author can make bigger (#681): wider, taller or both
function boxSize(kind: "section" | "passage", width: number, size: MapBoxSize | undefined) {
    const section = kind == "section";
    const wide = size == "wide" || size == "large", tall = size == "tall" || size == "large";
    return {
        width: wide ? Math.max(width, section ? 280 : 220) : width,
        height: section ? (tall ? 100 : SECTION_HEIGHT) : (tall ? 56 : PASSAGE_HEIGHT),
    };
}

// A rough width for a label, without measuring text (which a worker or a test can't do)
function labelWidth(label: string, charWidth: number, min: number, max: number) {
    return Math.round(Math.min(max, Math.max(min, label.length * charWidth + 20)));
}

// What the map says about a section or passage that isn't reachable from the start. Where the story
// goes somewhere that can't be known until it's played, it might be reached that way.
export function reachNote(node: GraphNode, graph: StoryGraph): string {
    if (node.embedded) return "Shown inside other sections.";
    if (node.reachable) return "";
    return graph.reachabilityKnown
        ? "Can't be reached from the start."
        : "Nothing reachable from the start links here, but it may be reached in a way only known as the story is played.";
}

// What a section or passage is called on the map
export function nodeLabel(node: GraphNode): string {
    return node.detail ?? (node.name || "(untitled)");
}

// `sizes` are the boxes the author has made bigger, by id (see nodeSizes)
export function buildStoryMap(graph: StoryGraph, sizes?: ReadonlyMap<string, MapBoxSize>): StoryMap {
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
        if (!n.reachable && !n.embedded && graph.reachabilityKnown) classes.push("unreachable");
        if (n.embedded) classes.push("embedded");
        if (n.unknownExits) classes.push("unknown-exits");
        if (n.detail) classes.push("unnamed");
        add({
            id: n.id,
            kind: n.kind,
            label,
            ...boxSize(n.kind, n.kind == "section" ? labelWidth(label, 7.4, 60, 190) + (n.start ? 12 : 0) : labelWidth(label, 6.8, 36, 150), sizes?.get(n.id)),
            ...(sizes?.has(n.id) ? { size: sizes.get(n.id) } : {}),
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
        node.description = describe(node, outgoing.get(node.id) ?? [], incoming.get(node.id) ?? [], byId, graph);
        node.title = tooltip(node, graph);
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
            : name == "@after" ? "@after runs after every other passage in the section"
            : /^@\d+$/.test(name) ? `${name} runs when that many passages in the section have been clicked`
            : `${name} runs on its own`;
    }
    const to = byId.get(edge.to)!;
    const texts = [...new Set(edge.edges.map(e => e.text).filter(Boolean))];
    const target = edge.broken ? `${to.label} (doesn't exist)` : to.label;
    const via = [...new Set(edge.edges.map(e => e.via).filter(Boolean))];
    return `${KIND_NAMES[edge.kind]}${edge.conditional ? " (conditional)" : ""} to ${target}${via.length ? `, when ${via.join(" or ")} is set to it` : ""}${texts.length ? `: "${texts.join("\", \"")}"` : ""}`;
}

// The tooltip: the whole name, which may be cut short on the map, and what its marks mean
function tooltip(node: StoryMapNode, graph: StoryGraph): string {
    if (node.kind == "missing") return `${node.label}\n! Missing: nothing in the story is called that. Double-click to add it.`;
    const g = node.graphNode!;
    const lines = [node.label];
    if (g.start) lines.push("The story starts here.");
    if (node.kind == "passage" && runsOnItsOwn(g.name)) lines.push("Runs on its own, without a link.");
    if (g.ending) lines.push("An ending (@end).");
    if (g.test) lines.push("For testing the story (@test): players can't get here.");
    if (g.deadEnd && g.reachable) lines.push("! A dead end: no way out, and not an ending.");
    if (g.unknownExits) lines.push("? Can go somewhere that isn't known until the story is played: a link or {{goto}} worked out as it's played, or JavaScript.");
    const reach = reachNote(g, graph);
    if (reach) lines.push(reach);
    return lines.join("\n");
}

function describe(node: StoryMapNode, out: StoryMapEdge[], into: StoryMapEdge[], byId: Map<string, StoryMapNode>, graph: StoryGraph): string {
    if (node.kind == "missing") return `Missing: ${node.label}. Nothing in the story is called that.`;
    const g = node.graphNode!;
    const parts = [`${node.kind == "section" ? "Section" : `Passage in ${byId.get(node.parent!)?.label ?? node.section}`} ${node.label}.`];
    if (g.start) parts.push("The story starts here.");
    if (node.kind == "passage" && runsOnItsOwn(g.name)) parts.push("Runs on its own, without a link.");
    if (g.ending) parts.push("An ending.");
    if (g.deadEnd && g.reachable) parts.push("A dead end: no way out.");
    const reach = reachNote(g, graph);
    if (reach) parts.push(reach);
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

// What's saved for sections by their keys (see sectionKeys), and for passages by their section's
// key and their own name: positions, and sizes
interface ByName<T> {
    sections: Record<string, T>;
    passages: Record<string, Record<string, T>>;
}

const copyByName = <T>(values: ByName<T> | undefined): ByName<T> => ({
    sections: { ...values?.sections },
    passages: Object.fromEntries(Object.entries(values?.passages ?? {}).map(([s, byName]) => [s, { ...byName }])),
});

// What's saved for each node, by node id
function byNodeId<T>(values: ByName<T> | undefined, graph: StoryGraph | null): Map<string, T> {
    const result = new Map<string, T>();
    if (!values || !graph) return result;
    const keys = sectionKeys(graph);
    for (const [name, key] of keys) {
        const value = values.sections[key];
        if (value !== undefined) result.set(sectionId(name), value);
    }
    for (const n of graph.nodes) {
        if (n.kind != "passage") continue;
        const key = keys.get(n.section!);
        const value = key === undefined ? undefined : values.passages[key]?.[n.name];
        if (value !== undefined) result.set(n.id, value);
    }
    return result;
}

// A copy with one node's value changed (or removed, with undefined)
function withValue<T>(values: ByName<T> | undefined, keys: Map<string, string>, node: Pick<GraphNode, "kind" | "name" | "section">, value: T | undefined): ByName<T> {
    const next = copyByName(values);
    if (node.kind == "section") {
        const key = keys.get(node.name) ?? node.name;
        if (value !== undefined) next.sections[key] = value;
        else delete next.sections[key];
    } else {
        const key = keys.get(node.section!) ?? node.section!;
        const byName = next.passages[key] ??= {};
        if (value !== undefined) byName[node.name] = value;
        else delete byName[node.name];
        if (!Object.keys(byName).length) delete next.passages[key];
    }
    return next;
}

// The saved positions, by node id
export function pinnedPositions(positions: MapPositions | undefined, graph: StoryGraph | null): Map<string, Point> {
    return new Map([...byNodeId(positions, graph)].map(([id, at]) => [id, { x: at[0], y: at[1] }]));
}

// The boxes the author has made bigger, by node id
export function nodeSizes(positions: MapPositions | undefined, graph: StoryGraph | null): Map<string, MapBoxSize> {
    return byNodeId(positions?.sizes, graph);
}

// Whether anything's been moved by hand, which Lay out again forgets
export const hasPositions = (positions: MapPositions | undefined) => !!positions && (Object.keys(positions.sections).length > 0 || Object.keys(positions.passages).length > 0);

// Whether there's anything to save: positions, or sizes
export const hasMapData = (positions: MapPositions | undefined) => hasPositions(positions)
    || !!positions?.sizes && (Object.keys(positions.sizes.sections).length > 0 || Object.keys(positions.sizes.passages).length > 0);

// No positions, keeping the boxes' sizes, for Lay out again
export const withoutPositions = (positions: MapPositions | undefined): MapPositions =>
    positions?.sizes ? { ...emptyPositions(), sizes: positions.sizes } : emptyPositions();

const withSizes = (positions: Omit<MapPositions, "sizes">, sizes: MapSizes | undefined): MapPositions => {
    const any = sizes && (Object.keys(sizes.sections).length || Object.keys(sizes.passages).length);
    return any ? { ...positions, sizes } : { sections: positions.sections, passages: positions.passages };
};

// A copy of the positions with one node's changed (or removed, with undefined). Only sections and
// passages have positions saved.
export function withPosition(positions: MapPositions | undefined, keys: Map<string, string>, node: Pick<GraphNode, "kind" | "name" | "section">, at: Point | undefined): MapPositions {
    return withSizes(withValue(positions, keys, node, at && [Math.round(at.x), Math.round(at.y)] as [number, number]), positions?.sizes);
}

// A copy of the positions with one node's box size changed (undefined for the usual size)
export function withSize(positions: MapPositions | undefined, keys: Map<string, string>, node: Pick<GraphNode, "kind" | "name" | "section">, size: MapBoxSize | undefined): MapPositions {
    return withSizes(copyByName(positions), withValue(positions?.sizes, keys, node, size));
}

// Undoes (or redoes) a change to the positions: wherever `from` and `to` differ, `current` takes
// what `to` has. Anything else in `current` is left alone, as it may have changed since (a
// section renamed, or another box moved).
export function revertPositions(current: MapPositions | undefined, from: MapPositions, to: MapPositions): MapPositions {
    return withSizes(revertByName(current, from, to), revertByName(current?.sizes, from.sizes, to.sizes));
}

function revertByName<T>(current: ByName<T> | undefined, from: ByName<T> | undefined, to: ByName<T> | undefined): ByName<T> {
    const same = (a: T | undefined, b: T | undefined) => JSON.stringify(a) === JSON.stringify(b);
    const revert = (now: Record<string, T>, a: Record<string, T>, b: Record<string, T>) => {
        const next = { ...now };
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
            if (same(a[key], b[key])) continue;
            if (b[key] !== undefined) next[key] = b[key];
            else delete next[key];
        }
        return next;
    };
    const passages: ByName<T>["passages"] = {};
    const sections = new Set([...Object.keys(current?.passages ?? {}), ...Object.keys(from?.passages ?? {}), ...Object.keys(to?.passages ?? {})]);
    for (const section of sections) {
        const next = revert(current?.passages[section] ?? {}, from?.passages[section] ?? {}, to?.passages[section] ?? {});
        if (Object.keys(next).length) passages[section] = next;
    }
    return { sections: revert(current?.sections ?? {}, from?.sections ?? {}, to?.sections ?? {}), passages };
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
    const moved = renameByName(positions, before, after);
    const sized = positions.sizes && renameByName(positions.sizes, before, after);
    if (!moved && !sized) return undefined;
    return withSizes(moved ?? positions, sized ?? positions.sizes);
}

// The same for positions or sizes: undefined if none changed
function renameByName<T>(positions: ByName<T>, before: StoryGraph, after: StoryGraph): ByName<T> | undefined {
    const beforeKeys = nodeKeys(before), afterKeys = nodeKeys(after);
    const afterById = new Map(after.nodes.map(n => [n.id, n]));
    // The same node: renamed, or with the same id and its header on the same line
    const pairs: [GraphNode, GraphNode][] = [...findRenames(before, after)];
    for (const n of before.nodes) {
        const same = afterById.get(n.id);
        if (same && same.location.file == n.location.file && same.location.range.start.line == n.location.range.start.line) pairs.push([n, same]);
    }
    let changed = false;
    const next = copyByName(positions);
    const split = (key: string) => key.split("\u0000") as [string, string?];
    // Sections first, as a renamed section's passages are renamed too
    for (const [from, to] of pairs) {
        if (from.kind != "section") continue;
        const a = beforeKeys.get(from.id), b = afterKeys.get(to.id);
        if (a === undefined || b === undefined || a == b) continue;
        if (next.sections[a] !== undefined) {
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
        if (at !== undefined) {
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

// A short preview of a section's or passage's own text, as a player would read it, for the map
// to show before it's opened: without its header, its passages, directives, JavaScript and
// comments, with links as their text and Markdown and HTML left out. Empty if there's no text.
export function nodeExcerpt(text: string, node: GraphNode, max = 240): string {
    const prose = ownLines(text.split(/\r?\n/), node.range.start.line, node.contentEnd.line, !!node.detail)
        // JavaScript is indented
        .filter(line => !/^(\t| {4})/.test(line) && !/^\s*@/.test(line))
        .join("\n")
        .replace(/\{\{!--[\s\S]*?--\}\}|\{\{![\s\S]*?\}\}|<!--[\s\S]*?-->/g, "")
        .replace(/<[^>]+>/g, "")
        // [[text]](target), [text](target), [[name]], [name]
        .replace(/\[\[([^\]]*)\]\]\([^)]*\)|\[([^\]]*)\]\([^)]*\)|\[\[([^\]]*)\]\]|\[([^\]]*)\]/g, (_, a, b, c, d) => a ?? b ?? c ?? d)
        .replace(/^\s*#+\s*/gm, "")
        .replace(/(\*\*|__|\*|_)(\S(?:.*?\S)?)\1/g, "$2")
        .replace(/\s+/g, " ")
        .trim();
    return prose.length > max ? `${prose.slice(0, max - 1).trimEnd()}…` : prose;
}

// An excerpt broken into at most `lines` lines of at most `chars` characters, at spaces where it
// can be, for the map to draw on a box when it's zoomed in (#681). The last line ends with an
// ellipsis if there's more.
export function wrapExcerpt(text: string, chars: number, lines: number): string[] {
    chars = Math.max(2, Math.floor(chars));
    const out: string[] = [];
    let rest = text.replace(/\s+/g, " ").trim();
    while (rest && out.length < lines) {
        if (rest.length <= chars) {
            out.push(rest);
            rest = "";
            break;
        }
        const space = rest.lastIndexOf(" ", chars);
        const end = space > chars / 3 ? space : chars;
        out.push(rest.slice(0, end).trimEnd());
        rest = rest.slice(end).trimStart();
    }
    if (rest && out.length) {
        const last = out[out.length - 1].replace(/…$/, "");
        // Room for the ellipsis, leaving out the last word rather than cutting it if there's one
        let cut = last;
        if (cut.length >= chars) {
            const space = cut.lastIndexOf(" ", chars - 1);
            cut = (space > 0 ? cut.slice(0, space) : cut.slice(0, chars - 1)).trimEnd();
        }
        out[out.length - 1] = `${cut.replace(/[\s,;:.]+$/, "")}…`;
    }
    return out;
}

// The lines of a section's or passage's own text, from its header at `start` to `end`, without
// the header. A section without a name of its own (`unnamed`: its +++ or --- line, or the text
// before the first section) has no header to leave out, only the +++ or ---.
function ownLines(lines: string[], start: number, end: number, unnamed: boolean): string[] {
    const own = lines.slice(unnamed ? start : start + 1, end + 1);
    if (unnamed && own.length) own[0] = own[0].replace(/^(\+\+\+|---)/, "");
    return own;
}

// A section's or passage's own text as it is in the script, for the map's search (#679): its
// directives, JavaScript and markup too, so a search can find where an attribute is set, but not
// its passages, which have their own boxes. In lower case, to compare with a search.
export function nodeText(lines: string[], node: GraphNode): string {
    return ownLines(lines, node.range.start.line, node.contentEnd.line, !!node.detail).join("\n").toLowerCase();
}

// The same for one of the outline's sections or passages, whose own text ends at its first passage
export function symbolText(lines: string[], symbol: DocumentSymbol): string {
    const end = symbol.children.length ? symbol.children[0].range.start.line - 1 : symbol.range.end.line;
    return ownLines(lines, symbol.range.start.line, end, !!symbol.detail).join("\n").toLowerCase();
}

// Lower-case text of each section and passage in the story, by id, for the map's search
export type NodeTexts = ReadonlyMap<string, string>;

// The boxes on the map a search finds, in the order they're listed: those whose names (or their
// sections' names) have it in them, then those whose text has, if `texts` has it. Broken links'
// markers only by what's missing. Null for no search.
export function searchMap(nodes: readonly StoryMapNode[], query: string, texts?: NodeTexts): StoryMapNode[] | null {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const byName: StoryMapNode[] = [];
    const byText: StoryMapNode[] = [];
    for (const n of nodes) {
        if (n.label.toLowerCase().includes(q) || n.section.toLowerCase().includes(q)) byName.push(n);
        else if (n.graphNode && texts?.get(n.id)?.includes(q)) byText.push(n);
    }
    return [...byName, ...byText];
}
