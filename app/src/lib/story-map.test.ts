import { describe, expect, test } from "vitest";
import { createLanguageService } from "squiffy-compiler/language-service";
import { buildStoryMap, checkSectionName, findRenames, linkTo, movedNodes, nodeAtLine, nodeExcerpt, nodeText, pinnedPositions, renamePositions, revertPositions, searchMap, sectionKeys, symbolText, withPosition } from "./story-map.js";

function serviceOf(text: string) {
    const files: Record<string, string> = { "story.squiffy": text };
    return createLanguageService({
        mainFile: "story.squiffy",
        files: { list: async () => Object.keys(files).map(path => ({ path })), readText: async path => files[path] },
    });
}

async function graphOf(text: string) {
    return serviceOf(text).getStoryGraph();
}

const story = `@title Test
[[start]]:
Go [[left]] or [[right]], or [look].

[look]:
Nothing.

[[left]]:
[[Back]](start) or [[nowhere]].

[[right]]:
{{#if seen}}[[left]]{{/if}} [[left]]

[[lost]]:
@end
Nothing links here.
`;

describe("story map", () => {
    test("sections ranked by the longest way from the start, so links point down, and passages under their sections", async () => {
        const map = buildStoryMap(await graphOf(story));
        const byId = Object.fromEntries(map.nodes.map(n => [n.id, n]));
        expect(byId["section:start"]).toMatchObject({ rank: 0, group: 0 });
        expect(byId["section:right"]).toMatchObject({ rank: 1, group: 0 });
        // right links to left too, so left goes below it
        expect(byId["section:left"]).toMatchObject({ rank: 2, group: 0 });
        expect(byId["passage:start/look"]).toMatchObject({ parent: "section:start", group: 0 });
        // Can't be reached: a group of its own
        expect(byId["section:lost"]).toMatchObject({ rank: 0, group: 1 });
        expect(byId["section:lost"].class).toContain("unreachable");
        expect(byId["section:lost"].class).toContain("ending");
        expect(byId["section:start"].class).toContain("start");
    });

    test("nothing is greyed out as unreachable when something reachable goes somewhere only known as it's played", async () => {
        const map = buildStoryMap(await graphOf("[[start]]:\n[[Go]]({{place}})\n\n[[lost]]:\n@end\n"));
        const lost = map.nodes.find(n => n.id == "section:lost")!;
        expect(lost.class).not.toContain("unreachable");
        expect(lost.title).toBe("lost\nAn ending (@end).\nNothing reachable from the start links here, but it may be reached in a way only known as the story is played.");
    });

    test("{{goto name}} is drawn to each section the story sets name to", async () => {
        const map = buildStoryMap(await graphOf("[[start]]:\n{{set \"vision\" \"smoke\"}}{{goto vision}}\n\n[[smoke]]:\n@end\n"));
        const edge = map.edges.find(e => e.kind == "goto")!;
        expect(edge).toMatchObject({ from: "section:start", to: "section:smoke" });
        expect(edge.title).toBe("Go to (conditional) to smoke, when vision is set to it");
        expect(map.nodes.find(n => n.id == "section:smoke")!.class).not.toContain("unreachable");
    });

    test("a broken link gets a marker under its section", async () => {
        const map = buildStoryMap(await graphOf(story));
        const missing = map.nodes.find(n => n.kind == "missing")!;
        expect(missing).toMatchObject({ label: "nowhere", parent: "section:left", decoration: true });
        expect(map.edges.find(e => e.to == missing.id)).toMatchObject({ from: "section:left", broken: true });
    });

    test("tooltips give the whole name and say what the marks on the map mean", async () => {
        const map = buildStoryMap(await graphOf(story + "\n[[stuck]]:\nNo way out.\n\n[[unsure]]:\n[[Somewhere]]({{place}})\n"));
        const title = (id: string) => map.nodes.find(n => n.id == id)!.title;
        expect(title("section:start")).toBe("start\nThe story starts here.");
        expect(title("section:lost")).toBe("lost\nAn ending (@end).\nCan't be reached from the start.");
        expect(title("section:stuck")).toBe("stuck\nCan't be reached from the start.");
        expect(title("section:unsure")).toMatch(/^unsure\n\? Can go somewhere that isn't known until the story is played/);
        expect(map.nodes.find(n => n.kind == "missing")!.title)
            .toBe("nowhere\n! Missing: nothing in the story is called that. Double-click to add it.");
        const deadEnd = buildStoryMap(await graphOf("[[a]]:\n[[b]]\n\n[[b]]:\nNo way out."));
        expect(deadEnd.nodes.find(n => n.id == "section:b")!.title).toBe("b\n! A dead end: no way out, and not an ending.");
    });

    test("a link to one of the master section's passages isn't broken", async () => {
        const map = buildStoryMap(await graphOf("[[a]]:\n[Wait](stare) {{embed \"stare\"}}\n@end\n\n[[]]:\n\n[stare]:\nYou stare."));
        expect(map.nodes.filter(n => n.kind == "missing")).toEqual([]);
        expect(map.edges.filter(e => e.broken)).toEqual([]);
    });

    test("links between the same places are drawn once, conditional only if they all are", async () => {
        const map = buildStoryMap(await graphOf(story));
        const edge = map.edges.find(e => e.from == "section:right" && e.to == "section:left")!;
        expect(edge.edges).toHaveLength(2);
        expect(edge.conditional).toBe(false);
        expect(edge.class).toBe("edge-section-link");
    });

    test("screen reader descriptions say where a node links to and from", async () => {
        const map = buildStoryMap(await graphOf(story));
        expect(map.nodes.find(n => n.id == "section:left")!.description)
            .toBe("Section left. Links to start, nowhere. Linked from start, right.");
    });
});

describe("passages that run on their own", () => {
    test("are tied to their section, as nothing links to them", async () => {
        const map = buildStoryMap(await graphOf("[[a]]:\n[p]\n\n[p]:\nx\n\n[@last]:\n[[b]]\n\n[@1]:\nOne.\n\n[[b]]:\n@end"));
        expect(map.edges.filter(e => e.kind == "auto").map(e => [e.from, e.to])).toEqual([
            ["section:a", "passage:a/@last"],
            ["section:a", "passage:a/@1"],
        ]);
        // Not counted as links in the descriptions
        expect(map.nodes.find(n => n.id == "section:a")!.description).toBe("Section a. The story starts here. Links to p.");
        expect(map.nodes.find(n => n.id == "passage:a/@last")!.description).toContain("Runs on its own");
    });
});

describe("positions", () => {
    test("saved by name, and read back by node id", async () => {
        const graph = await graphOf(story);
        const keys = sectionKeys(graph);
        const left = graph.nodes.find(n => n.id == "section:left")!;
        const look = graph.nodes.find(n => n.id == "passage:start/look")!;
        let positions = withPosition(undefined, keys, left, { x: 10.4, y: -20.6 });
        positions = withPosition(positions, keys, look, { x: 1, y: 2 });
        expect(positions).toEqual({ sections: { left: [10, -21] }, passages: { start: { look: [1, 2] } } });
        expect([...pinnedPositions(positions, graph)]).toEqual([["section:left", { x: 10, y: -21 }], ["passage:start/look", { x: 1, y: 2 }]]);
        expect(withPosition(positions, keys, look, undefined)).toEqual({ sections: { left: [10, -21] }, passages: {} });
    });

    const anonymous = "Hello.\n\n[[a]]:\n[p]\n\n[p]:\nx\n+++Day Two\n[Talk]\n\n[Talk]:\nHi.\n\n[@last]:\n[[b]]\n\n[[b]]:\n---\nOne.\n---\nTwo.\n\n[[c]]:\n---\nThree.\n";

    test("a section without a name of its own is saved under what the map calls it", async () => {
        const graph = await graphOf(anonymous);
        expect(Object.fromEntries(sectionKeys(graph))).toEqual({
            _default: "(Start)",
            a: "a",
            _continue1: "+++Day Two",
            b: "b",
            _continue2: "--- after b",
            _continue3: "--- after b (2)",
            c: "c",
            _continue4: "--- after c",
        });
        const keys = sectionKeys(graph);
        const talk = graph.nodes.find(n => n.id == "passage:_continue1/Talk")!;
        expect(withPosition(undefined, keys, talk, { x: 1, y: 2 })).toEqual({ sections: {}, passages: { "+++Day Two": { Talk: [1, 2] } } });
    });

    test("adding a section above one without a name of its own leaves its position where it was", async () => {
        const before = await graphOf(anonymous);
        const positions = { sections: { "+++Day Two": [5, 6] as [number, number] }, passages: { "+++Day Two": { "@last": [7, 8] as [number, number] } } };
        const after = await graphOf(anonymous.replace("[[a]]:", "+++Prologue\nOnce.\n\n[[a]]:"));
        // Day Two is now _continue2, and keeps its position
        expect([...pinnedPositions(positions, after)]).toEqual([["section:_continue2", { x: 5, y: 6 }], ["passage:_continue2/@last", { x: 7, y: 8 }]]);
        expect(renamePositions(positions, before, after)).toBeUndefined();
        // and the map moves its place to its new id
        expect(movedNodes(before, after)).toContainEqual(["section:_continue1", "section:_continue2"]);
        expect(movedNodes(before, after)).toContainEqual(["passage:_continue1/Talk", "passage:_continue2/Talk"]);
    });

    test("changing a +++ line's text keeps its position", async () => {
        const before = await graphOf(anonymous);
        const after = await graphOf(anonymous.replace("+++Day Two", "+++The next day"));
        const positions = { sections: { "+++Day Two": [5, 6] as [number, number] }, passages: { "+++Day Two": { Talk: [7, 8] as [number, number] } } };
        expect(renamePositions(positions, before, after)).toEqual({ sections: { "+++The next day": [5, 6] }, passages: { "+++The next day": { Talk: [7, 8] } } });
    });

    test("a renamed section keeps its position and its passages'", async () => {
        const before = await graphOf(story);
        const after = await graphOf(story.replace("[[start]]:", "[[begin]]:").replace("[look]:", "[peek]:"));
        expect(findRenames(before, after).map(([a, b]) => [a.id, b.id])).toEqual([
            ["section:start", "section:begin"],
            ["passage:start/look", "passage:begin/peek"],
        ]);
        const positions = renamePositions({ sections: { start: [1, 2] }, passages: { start: { look: [3, 4] } } }, before, after);
        expect(positions).toEqual({ sections: { begin: [1, 2] }, passages: { begin: { peek: [3, 4] } } });
        expect(renamePositions({ sections: { other: [1, 2] }, passages: {} }, before, after)).toBeUndefined();
    });
});

describe("rows", () => {
    test("links back round a loop don't push sections down", async () => {
        const map = buildStoryMap(await graphOf("[[a]]:\n[[b]]\n\n[[b]]:\n[[c]] [[d]]\n\n[[c]]:\n[[next]]\n\n[[d]]:\n[[next]]\n\n[[next]]:\n[[a]] [[end]]\n\n[[end]]:\n@end"));
        const rank = Object.fromEntries(map.nodes.map(n => [n.label, n.rank]));
        expect(rank).toEqual({ a: 0, b: 1, c: 2, d: 2, next: 3, end: 4 });
    });
});

describe("editing from the map", () => {
    test("links to sections, and to passages in the same section", async () => {
        const graph = await graphOf(`${story}\n[[other]]:\n[p]:\n+++More\n`);
        const node = (id: string) => graph.nodes.find(n => n.id == id)!;
        expect(linkTo(node("section:left"), node("section:right"))).toEqual({ text: "[[right]]" });
        expect(linkTo(node("section:start"), node("passage:start/look"))).toEqual({ text: "[look]" });
        expect(linkTo(node("section:left"), node("passage:start/look"))).toHaveProperty("error");
        expect(linkTo(node("section:left"), node("section:_continue1"))).toHaveProperty("error");
    });

    test("new section names", async () => {
        const graph = await graphOf(story);
        expect(checkSectionName("cave", graph)).toBeUndefined();
        expect(checkSectionName("left", graph)).toContain("already");
        expect(checkSectionName(" cave", graph)).toBeDefined();
        expect(checkSectionName("a,b", graph)).toBeDefined();
    });

    test("the section or passage a line is in", async () => {
        const graph = await graphOf(story);
        expect(nodeAtLine(graph, "story.squiffy", 2)?.id).toBe("section:start");
        expect(nodeAtLine(graph, "story.squiffy", 5)?.id).toBe("passage:start/look");
        expect(nodeAtLine(graph, "story.squiffy", 8)?.id).toBe("section:left");
        expect(nodeAtLine(graph, "other.squiffy", 8)).toBeUndefined();
    });
});

test("undoing a change to the positions leaves what's changed since", () => {
    const before = { sections: { a: [1, 1] as [number, number] }, passages: { a: { p: [5, 5] as [number, number] } } };
    // a moved, b added, and a's passage let go
    const after = { sections: { a: [2, 2] as [number, number], b: [3, 3] as [number, number] }, passages: {} };
    // Since then, c was moved
    const now = { sections: { ...after.sections, c: [9, 9] as [number, number] }, passages: {} };
    expect(revertPositions(now, after, before)).toEqual({ sections: { a: [1, 1], c: [9, 9] }, passages: { a: { p: [5, 5] } } });
    expect(revertPositions(revertPositions(now, after, before), before, after)).toEqual(now);
    expect(revertPositions(undefined, before, after)).toEqual(after);
});

describe("excerpts", () => {
    test("a section's own text, as a player reads it", async () => {
        const text = `[[start]]:
@set score = 1
# Welcome
You're in a **dark** cave. Go [[left]] or [[right]](cave right), or [look].
    console.log("hi");
{{!-- a note --}}
<p class="x">Mind the step.</p>

[look]:
Nothing.

[[left]]:
Left.

[[right]]:
Right.`;
        const graph = await graphOf(text);
        const node = (id: string) => graph.nodes.find(n => n.id === id)!;
        expect(nodeExcerpt(text, node("section:start"))).toBe("Welcome You're in a dark cave. Go left or right, or look. Mind the step.");
        expect(nodeExcerpt(text, node("passage:start/look"))).toBe("Nothing.");
        expect(nodeExcerpt(text, node("section:right"))).toBe("Right.");
        expect(nodeExcerpt(text, node("section:start"), 20)).toBe("Welcome You're in a…");
    });

    test("the text before the first section, and an empty section", async () => {
        const text = `Once upon a time.

[[end]]:
`;
        const graph = await graphOf(text);
        const start = graph.nodes.find(n => n.kind === "section" && n.detail)!;
        expect(nodeExcerpt(text, start)).toBe("Once upon a time.");
        expect(nodeExcerpt(text, graph.nodes.find(n => n.id === "section:end")!)).toBe("");
    });
});

describe("searching the map by text (#679)", () => {
    const text = `[[start]]:
You find a **Rusty Key** here. Go [[on]].
@set gold = 5

[look]:
A lamp, unlit.

[[on]]:
The key opens the door.

[[key room]]:
Empty.
`;

    test("a node's own text, in lower case, with its directives but not its header or passages", async () => {
        const graph = await graphOf(text);
        const lines = text.split("\n");
        const node = (id: string) => graph.nodes.find(n => n.id === id)!;
        const start = nodeText(lines, node("section:start"));
        expect(start).toContain("rusty key");
        expect(start).toContain("@set gold = 5");
        expect(start).not.toContain("[[start]]");
        expect(start).not.toContain("lamp");
        expect(nodeText(lines, node("passage:start/look"))).toBe("a lamp, unlit.");
    });

    test("finds boxes by name first, then by text, and fades the rest", async () => {
        const graph = await graphOf(text);
        const lines = text.split("\n");
        const texts = new Map(graph.nodes.map(n => [n.id, nodeText(lines, n)]));
        const nodes = buildStoryMap(graph).nodes;
        const ids = (q: string, t?: Map<string, string>) => searchMap(nodes, q, t)?.map(n => n.id);
        expect(ids("", texts)).toBeUndefined();
        // Without the text, only the name
        expect(ids("key")).toEqual(["section:key room"]);
        expect(ids(" KEY ", texts)).toEqual(["section:key room", "section:start", "section:on"]);
        expect(ids("lamp", texts)).toEqual(["passage:start/look"]);
        expect(ids("gold", texts)).toEqual(["section:start"]);
        expect(ids("dragon", texts)).toEqual([]);
    });

    test("the outline's sections and passages by their own text", async () => {
        const symbols = await serviceOf(text).getDocumentSymbols("story.squiffy");
        const lines = text.split("\n");
        const start = symbols.find(s => s.name === "start")!;
        expect(symbolText(lines, start)).toContain("rusty key");
        expect(symbolText(lines, start)).not.toContain("lamp");
        expect(symbolText(lines, start.children[0])).toContain("lamp");
    });
});
