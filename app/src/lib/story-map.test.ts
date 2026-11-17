import { describe, expect, test } from "vitest";
import { createLanguageService } from "squiffy-compiler/language-service";
import { buildStoryMap, checkSectionName, findRenames, linkTo, movedNodes, nodeAtLine, pinnedPositions, renamePositions, sectionKeys, withPosition } from "./story-map.js";

async function graphOf(text: string) {
    const files: Record<string, string> = { "story.squiffy": text };
    const service = createLanguageService({
        mainFile: "story.squiffy",
        files: { list: async () => Object.keys(files).map(path => ({ path })), readText: async path => files[path] },
    });
    return service.getStoryGraph();
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

    test("a broken link gets a marker under its section", async () => {
        const map = buildStoryMap(await graphOf(story));
        const missing = map.nodes.find(n => n.kind == "missing")!;
        expect(missing).toMatchObject({ label: "nowhere", parent: "section:left", decoration: true });
        expect(map.edges.find(e => e.to == missing.id)).toMatchObject({ from: "section:left", broken: true });
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
