import { describe, expect, test } from "vitest";
import { createLanguageService } from "squiffy-compiler/language-service";
import { buildStoryMap, checkSectionName, findRenames, linkTo, nodeAtLine, pinnedPositions, renamePositions, withPosition } from "./story-map.js";

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
    test("sections ranked by their distance from the start, passages under their sections", async () => {
        const map = buildStoryMap(await graphOf(story));
        const byId = Object.fromEntries(map.nodes.map(n => [n.id, n]));
        expect(byId["section:start"]).toMatchObject({ rank: 0, group: 0 });
        expect(byId["section:left"]).toMatchObject({ rank: 1, group: 0 });
        expect(byId["section:right"]).toMatchObject({ rank: 1, group: 0 });
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

describe("positions", () => {
    test("saved by name, and read back by node id", async () => {
        const graph = await graphOf(story);
        const left = graph.nodes.find(n => n.id == "section:left")!;
        const look = graph.nodes.find(n => n.id == "passage:start/look")!;
        let positions = withPosition(undefined, left, { x: 10.4, y: -20.6 });
        positions = withPosition(positions, look, { x: 1, y: 2 });
        expect(positions).toEqual({ sections: { left: [10, -21] }, passages: { start: { look: [1, 2] } } });
        expect([...pinnedPositions(positions)]).toEqual([["section:left", { x: 10, y: -21 }], ["passage:start/look", { x: 1, y: 2 }]]);
        expect(withPosition(positions, look, undefined)).toEqual({ sections: { left: [10, -21] }, passages: {} });
    });

    test("a renamed section keeps its position and its passages'", async () => {
        const before = await graphOf(story);
        const after = await graphOf(story.replace("[[start]]:", "[[begin]]:").replace("[look]:", "[peek]:"));
        const renames = findRenames(before, after);
        expect(renames.map(([a, b]) => [a.id, b.id])).toEqual([
            ["section:start", "section:begin"],
            ["passage:start/look", "passage:begin/peek"],
        ]);
        const positions = renamePositions({ sections: { start: [1, 2] }, passages: { start: { look: [3, 4] } } }, renames);
        expect(positions).toEqual({ sections: { begin: [1, 2] }, passages: { begin: { peek: [3, 4] } } });
        expect(renamePositions({ sections: { other: [1, 2] }, passages: {} }, renames)).toBeUndefined();
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
