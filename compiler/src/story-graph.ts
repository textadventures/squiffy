// The whole story as a directed graph: its sections and passages, and the links between them,
// with which can be reached from the start and which sections are dead ends. The language
// service builds it from its index (see getStoryGraph), for the story map and for the
// "unreachable section" and "dead end" diagnostics.

import type { Location } from "./language-service.js";
import type {
    DeactivateNode, Diagnostic, EmbedNode, GotoNode, LinkNode, PassageNode, Position, Range, SectionNode, SquiffyFile,
} from "./syntax.js";

export interface StoryGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

export interface GraphNode {
    // Stable across edits that don't rename it: "section:Cave" or "passage:Cave/look"
    id: string;
    kind: "section" | "passage";
    // The name in the story, including names given to unnamed sections such as "_default" and
    // "_continue1". The master section, whose content is part of every section, is "".
    name: string;
    // For passages, the section they're in
    section?: string;
    // What to call a section without a name of its own: what its +++ line says, "---" or
    // "(Start)" for the text before the first section, as in the outline
    detail?: string;
    // The name in the header (or the header itself, for a section without a name of its own)
    location: Location;
    // Where its own text ends (before any passages, for a section), ignoring blank lines at the
    // end: where a new link from it can be added
    contentEnd: Position;
    // The section the story starts at
    start?: boolean;
    // Whether the player can get here from the start. For a passage, its section has to be
    // reachable and something has to link to it, except for special passages such as @last,
    // which can run whenever their section can.
    reachable: boolean;
    // Not reachable, but its text is shown inside something that is, by {{embed}} or
    // {{live ... section=}}: a part of other sections rather than a place of its own
    embedded?: boolean;
    // A section with no way out: no links to a section (in it, its passages, or anything they
    // embed) and no navigation that can't be followed. Never true for an ending.
    deadEnd: boolean;
    // A section marked with @end as one of the story's endings
    ending?: boolean;
    // A section (or anything in it) navigates somewhere that can't be known before the story is
    // run: a link whose target is a Handlebars expression, a {{section}} helper written by hand,
    // or squiffy.story.go() in JavaScript without a literal section name.
    unknownExits?: boolean;
}

export type GraphEdgeKind =
    // [[section links]], including [[next>]] links and the link a +++ line adds
    | "section-link"
    // [passage links]
    | "passage-link"
    // {{embed}}: the target's content is shown here, so its links are too, but it isn't
    // navigation, so it doesn't make the target reachable
    | "embed"
    // {{goto}} (#375)
    | "goto"
    // squiffy.story.go("name") in JavaScript, with a literal section name
    | "script";

export interface GraphEdge {
    // Node ids
    from: string;
    // Undefined for a broken link, or one whose target is only known when the story is run
    to?: string;
    kind: GraphEdgeKind;
    // Inside an {{#if}} or {{#unless}}. Reachability treats it as possible.
    conditional: boolean;
    // Its target is a Handlebars expression, so it can't be followed
    dynamic?: boolean;
    // The link, embed or script in the source
    location: Location;
    // The link text
    text?: string;
    // For a link or embed whose target doesn't exist, the name it's written with
    target?: string;
    // Attributes the link sets, e.g. "gold+=1"
    setters?: string[];
}

export const sectionId = (name: string) => `section:${name}`;
export const passageId = (section: string, name: string) => `passage:${section}/${name}`;

// What the graph is built from: the language service's index
export interface GraphUsage {
    file: string;
    container: SectionNode | PassageNode;
    sectionNode: SectionNode;
    link?: LinkNode;
    embed?: EmbedNode;
    goto?: GotoNode;
    // {{deactivate}} names a passage, but isn't a way to get there, so it has no edge
    deactivate?: DeactivateNode;
}

export type GraphTarget =
    | { kind: "section"; name: string }
    | { kind: "passage"; section: string; name: string };

export interface GraphSource {
    files: Map<string, SquiffyFile>;
    sections: Map<string, { file: string; node?: SectionNode; passages: Map<string, PassageNode> }>;
    nodeNames: Map<SectionNode, string>;
    usages: GraphUsage[];
    start: string;
    resolve(usage: GraphUsage): GraphTarget | undefined;
}

const NAVIGATION: ReadonlySet<GraphEdgeKind> = new Set(["section-link", "goto", "script"]);

const collapsed = (position: Position): Range => ({ start: position, end: position });

const comparePositions = (a: Position, b: Position) => a.line - b.line || a.character - b.character;

// The parts of a container's text inside {{#if}} or {{#unless}} blocks
function conditionalRanges(container: SectionNode | PassageNode): Range[] {
    const ranges: Range[] = [];
    const open: Position[] = [];
    for (const statement of container.body) {
        if (statement.type != "text") continue;
        for (const match of statement.text.matchAll(/\{\{~?\s*([#/])(if|unless)\b/g)) {
            const position = { line: statement.range.start.line, character: match.index };
            if (match[1] == "#") {
                open.push(position);
            }
            else {
                const start = open.pop();
                if (start) ranges.push({ start, end: position });
            }
        }
    }
    // An unclosed block runs to the end
    for (const start of open) ranges.push({ start, end: container.range.end });
    return ranges;
}

// What the outline calls a section without a name of its own
function sectionDetail(node: SectionNode): string | undefined {
    if (node.kind == "preamble") return "(Start)";
    if (node.header?.type == "continue") return `+++${node.header.text}`;
    if (node.header?.type == "separator") return "---";
    return undefined;
}

// The end of a section's or passage's own text, leaving out blank lines and its passages
function contentEnd(container: SectionNode | PassageNode): Position {
    const ownEnd = container.type == "section" && container.passages.length
        ? container.passages[0].range.start
        : container.range.end;
    let end = container.header?.range.end ?? container.range.start;
    for (const statement of container.body) {
        if (comparePositions(statement.range.start, ownEnd) >= 0) break;
        if (statement.type == "text" && !statement.text.trim()) continue;
        if (comparePositions(statement.range.end, end) > 0) end = statement.range.end;
    }
    return end;
}

export function buildStoryGraph(source: GraphSource): StoryGraph {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeById = new Map<string, GraphNode>();
    const containerIds = new Map<SectionNode | PassageNode, string>();
    // Containers with navigation that can't be followed
    const unknown = new Set<string>();
    const endings = new Set<string>();
    // {{live}} helpers that show a section or passage
    const liveEmbeds: { container: SectionNode | PassageNode; from: string; file: string; sectionName: string; kind: "section" | "passage"; target: string; range: Range }[] = [];

    const addNode = (node: GraphNode) => {
        nodes.push(node);
        nodeById.set(node.id, node);
    };

    for (const [name, section] of source.sections) {
        const id = sectionId(name);
        const node = section.node;
        const range = node
            ? node.nameRange ?? node.header?.range ?? collapsed(node.range.start)
            : collapsed({ line: 0, character: 0 });
        const detail = node ? sectionDetail(node) : undefined;
        addNode({
            id, kind: "section", name, ...(detail ? { detail } : {}),
            location: { file: section.file, range }, contentEnd: node ? contentEnd(node) : range.end,
            reachable: false, deadEnd: false,
            ...(name == source.start ? { start: true } : {}),
        });
        if (node) containerIds.set(node, id);
        for (const [passageName, passage] of section.passages) {
            const pid = passageId(name, passageName);
            addNode({
                id: pid, kind: "passage", name: passageName, section: name,
                location: { file: section.file, range: passage.nameRange }, contentEnd: contentEnd(passage),
                reachable: false, deadEnd: false,
            });
            containerIds.set(passage, pid);
        }

        // @end, and navigation the links don't show
        for (const container of node ? [node, ...section.passages.values()] : []) {
            const from = containerIds.get(container)!;
            for (const statement of container.body) {
                if (statement.type == "end") {
                    endings.add(name);
                }
                else if (statement.type == "text") {
                    if (/\{\{~?\s*section\s/.test(statement.text)) unknown.add(from);
                    // {{goto}} with an expression, e.g. {{goto (random (array "a" "b"))}}
                    if (/\{\{~?\s*goto\s+[^\s"'}]/.test(statement.text)) unknown.add(from);
                    // {{live "x" section="name"}} and passage="name" show that section's or
                    // passage's text, and so its links, as {{embed}} does
                    for (const match of statement.text.matchAll(/\{\{~?\s*live\s[^}]*?\b(section|passage)\s*=\s*(["'])([^"']*)\2[^}]*\}\}/g)) {
                        const line = statement.range.start.line;
                        liveEmbeds.push({
                            container, from, file: section.file, sectionName: name, kind: match[1] as "section" | "passage", target: match[3],
                            range: { start: { line, character: match.index }, end: { line, character: match.index + match[0].length } },
                        });
                    }
                }
                else if (statement.type == "js") {
                    for (const match of statement.code.matchAll(/\.go\s*\(\s*(?:(["'])([^"'\\]*)\1\s*\))?/g)) {
                        const target = match[2];
                        if (target === undefined) {
                            unknown.add(from);
                            continue;
                        }
                        const start = statement.codeRange.start.character + match.index;
                        edges.push({
                            from,
                            ...(source.sections.has(target) ? { to: sectionId(target) } : {}),
                            kind: "script",
                            conditional: false,
                            location: {
                                file: section.file,
                                range: { start: { line: statement.range.start.line, character: start }, end: { line: statement.range.start.line, character: start + match[0].length } },
                            },
                        });
                    }
                }
            }
        }
    }

    // The link a +++ line adds to the section before it
    for (const [file, tree] of source.files) {
        const all = [tree.preamble, ...tree.sections];
        for (let i = 1; i < all.length; i++) {
            const node = all[i];
            if (node.type != "section" || node.header?.type != "continue") continue;
            const previous = all[i - 1];
            const name = source.nodeNames.get(node);
            const previousName = previous.type == "section" ? source.nodeNames.get(previous) : undefined;
            if (name === undefined || previousName === undefined) continue;
            edges.push({
                from: sectionId(previousName),
                to: sectionId(name),
                kind: "section-link",
                conditional: false,
                location: { file, range: node.header.range },
                text: node.header.text || "Continue...",
            });
        }
    }

    const conditionals = new Map<SectionNode | PassageNode, Range[]>();
    const isConditional = (container: SectionNode | PassageNode, position: Position) => {
        let ranges = conditionals.get(container);
        if (!ranges) {
            ranges = conditionalRanges(container);
            conditionals.set(container, ranges);
        }
        return ranges.some(r => comparePositions(r.start, position) <= 0 && comparePositions(position, r.end) <= 0);
    };

    for (const usage of source.usages) {
        if (usage.deactivate) continue;
        const from = containerIds.get(usage.container);
        // Not part of the story, or replaced by a later section or passage of the same name
        if (from === undefined) continue;
        const target = source.resolve(usage);
        const to = target && (target.kind == "section" ? sectionId(target.name) : passageId(target.section, target.name));
        const range = (usage.link ?? usage.embed ?? usage.goto)!.range;
        const conditional = isConditional(usage.container, range.start);
        const location = { file: usage.file, range };
        if (usage.embed) {
            edges.push({ from, ...(to ? { to } : { target: usage.embed.name }), kind: "embed", conditional, location });
            continue;
        }
        if (usage.goto) {
            edges.push({ from, ...(to ? { to } : { target: usage.goto.name }), kind: "goto", conditional, location });
            continue;
        }
        const link = usage.link!;
        const dynamic = !to && link.target.includes("{{");
        if (dynamic) unknown.add(from);
        const resolvedName = target?.name;
        const setters = link.form != "next" && link.target.trim() == resolvedName
            ? []
            : link.target.split(",").slice(1).map(s => s.trim()).filter(Boolean);
        const text = link.text ?? link.target.trim().split(",")[0].trim();
        edges.push({
            from,
            ...(to ? { to } : {}),
            kind: link.linkType == "section" ? "section-link" : "passage-link",
            conditional,
            ...(dynamic ? { dynamic } : {}),
            location,
            ...(text ? { text } : {}),
            ...(!to && !dynamic && link.form != "next" ? { target: link.target.split(",")[0].trim() } : {}),
            ...(setters.length ? { setters } : {}),
        });
    }

    for (const live of liveEmbeds) {
        const to = live.kind == "section"
            ? source.sections.has(live.target) ? sectionId(live.target) : undefined
            : source.sections.get(live.sectionName)?.passages.has(live.target) ? passageId(live.sectionName, live.target) : undefined;
        edges.push({
            from: live.from,
            ...(to ? { to } : { target: live.target }),
            kind: "embed",
            conditional: isConditional(live.container, live.range.start),
            location: { file: live.file, range: live.range },
        });
    }

    // In the order they're written
    const fileOrder = new Map([...source.files.keys()].map((file, i) => [file, i]));
    edges.sort((a, b) => (fileOrder.get(a.location.file) ?? -1) - (fileOrder.get(b.location.file) ?? -1)
        || comparePositions(a.location.range.start, b.location.range.start));

    const outgoing = new Map<string, GraphEdge[]>();
    for (const edge of edges) {
        let list = outgoing.get(edge.from);
        if (!list) outgoing.set(edge.from, list = []);
        list.push(edge);
    }

    // Passages by section, for special passages
    const passagesOf = new Map<string, GraphNode[]>();
    for (const node of nodes) {
        if (node.kind != "passage") continue;
        let list = passagesOf.get(node.section!);
        if (!list) passagesOf.set(node.section!, list = []);
        list.push(node);
    }

    // ---- Reachability ----
    // Containers whose content is shown: reachable ones, and anything they embed
    const shown = new Set<string>();
    const toShow: string[] = [];
    const show = (id: string) => {
        if (shown.has(id)) return;
        shown.add(id);
        toShow.push(id);
    };
    const reach = (id: string | undefined) => {
        const node = id === undefined ? undefined : nodeById.get(id);
        if (!node || node.reachable) return;
        node.reachable = true;
        show(node.id);
        if (node.kind == "section") {
            // Passages such as @last and @1 run on their own when their section's passages do
            for (const passage of passagesOf.get(node.name) ?? []) {
                if (passage.name.startsWith("@")) reach(passage.id);
            }
        }
        else if (node.name != "") {
            // A passage called "" runs whenever another passage in its section does
            reach(passageId(node.section!, ""));
        }
    };

    if (nodeById.has(sectionId(source.start))) {
        reach(sectionId(source.start));
        // The master section's content is part of every section
        reach(sectionId(""));
    }
    while (toShow.length) {
        const id = toShow.pop()!;
        for (const edge of outgoing.get(id) ?? []) {
            if (edge.to === undefined) continue;
            if (edge.kind == "embed") show(edge.to);
            else reach(edge.to);
        }
    }
    // Shown inside something that can be reached, though not reached itself
    for (const node of nodes) {
        if (!node.reachable && shown.has(node.id)) node.embedded = true;
    }

    // ---- Dead ends ----
    const masterIds = nodeById.has(sectionId(""))
        ? [sectionId(""), ...(passagesOf.get("") ?? []).map(p => p.id)]
        : [];
    for (const node of nodes) {
        if (node.kind != "section") continue;
        const ending = endings.has(node.name);
        if (ending) node.ending = true;
        // What's shown in this section: its own content, its passages', the master section's,
        // and anything those embed
        const seen = new Set<string>();
        const queue = [node.id, ...(passagesOf.get(node.name) ?? []).map(p => p.id), ...masterIds];
        let wayOut = false;
        let unknownExits = false;
        while (queue.length) {
            const id = queue.pop()!;
            if (seen.has(id)) continue;
            seen.add(id);
            if (unknown.has(id)) unknownExits = true;
            for (const edge of outgoing.get(id) ?? []) {
                if (NAVIGATION.has(edge.kind)) wayOut = true;
                else if (edge.kind == "embed" && edge.to) queue.push(edge.to);
            }
        }
        if (unknownExits) node.unknownExits = true;
        const hasContent = source.sections.get(node.name)?.node !== undefined;
        node.deadEnd = hasContent && node.name != "" && !ending && !wayOut && !unknownExits;
    }

    return { nodes, edges };
}

// "Unreachable section" and "dead end" warnings, for the language service's diagnostics
export function storyGraphDiagnostics(graph: StoryGraph): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const sections = graph.nodes.filter(n => n.kind == "section");
    // If the story starts at a section that doesn't exist, or anything that can be reached
    // navigates somewhere that can't be known, any section might be reachable
    const checkReachable = sections.some(n => n.start) && !sections.some(n => n.reachable && n.unknownExits);
    for (const node of sections) {
        // The master section, which is part of every section
        if (node.name == "") continue;
        if (!node.reachable) {
            if (!checkReachable || node.embedded) continue;
            diagnostics.push({
                file: node.location.file,
                range: node.location.range,
                severity: "warning",
                code: "squiffy/unreachable-section",
                message: `The section "${node.name}" can't be reached from the start of the story, as nothing the player can reach links to it.`,
            });
        }
        else if (node.deadEnd) {
            diagnostics.push({
                file: node.location.file,
                range: node.location.range,
                severity: "warning",
                code: "squiffy/dead-end",
                message: `The section "${node.name}" has no way out, as it has no links to another section. If it's one of the story's endings, add @end to say so.`,
            });
        }
    }
    return diagnostics;
}
