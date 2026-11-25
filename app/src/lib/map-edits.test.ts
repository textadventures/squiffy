import { describe, expect, test } from "vitest";
import { createLanguageService, type GraphNode, type StoryGraph } from "squiffy-compiler/language-service";
import { applyEditsToString } from "./language/codemirror.js";
import {
    blockOf, checkPassageName, deleteLinesEdits, deletionMessage, endingEdit, insertHeaderEdit, linkThenHeaderEdits, placeNewPassage, placeNewSection, planDeletion, startEdit,
} from "./map-edits.js";

async function graphOf(text: string, others: Record<string, string> = {}) {
    const files: Record<string, string> = { "story.squiffy": text, ...others };
    const service = createLanguageService({
        mainFile: "story.squiffy",
        files: { list: async () => Object.keys(files).map(path => ({ path })), readText: async path => files[path] },
    });
    return service.getStoryGraph();
}

const node = (graph: StoryGraph, id: string): GraphNode => {
    const found = graph.nodes.find(n => n.id == id);
    if (!found) throw new Error(`No ${id}`);
    return found;
};

// The story with a section added from the map
async function added(text: string, where: { from?: string; near?: string }, name = "new") {
    const graph = await graphOf(text);
    const place = placeNewSection(graph, {
        from: where.from ? node(graph, where.from) : undefined,
        near: where.near ? node(graph, where.near) : undefined,
        file: "story.squiffy",
    });
    return applyEditsToString(text, [insertHeaderEdit(text, place.afterLine, `[[${name}]]:`)]);
}

const headers = (text: string) => text.split("\n").filter(line => /^\[\[.*\]\]:$|^\+\+\+|^---$|^\[[^[].*\]:$/.test(line)).map(line => line.replace(/^\[\[(.*)\]\]:$/, "$1"));

describe("where a new section goes", () => {
    const story = `[[start]]:
Go [[left]] or [[right]].

[[left]]:
On to the [[end]].

[[right]]:
On to the [[end]].

[[end]]:
@end
Done.
`;

    test("linked from a section: after the last of its own children", async () => {
        expect(headers(await added(story, { from: "section:start" }))).toEqual(["start", "left", "right", "new", "end"]);
    });

    test("not after a section something earlier links to first", async () => {
        // "end" is left's, so a new choice from right goes straight after right
        expect(headers(await added(story, { from: "section:right" }))).toEqual(["start", "left", "right", "new", "end"]);
        // and one from left goes after it
        expect(headers(await added(story, { from: "section:left" }))).toEqual(["start", "left", "right", "end", "new"]);
    });

    test("with no children after it, straight after it and its passages", async () => {
        const text = "[[a]]:\nLook at the [door].\n\n[door]:\nIt's a door.\n\n[[b]]:\nBack to [[a]].\n";
        expect(await added(text, { from: "section:a" })).toBe("[[a]]:\nLook at the [door].\n\n[door]:\nIt's a door.\n\n[[new]]:\n\n[[b]]:\nBack to [[a]].\n");
        // From a passage, it's the passage's section that counts
        expect(headers(await added(text, { from: "passage:a/door" }))).toEqual(["a", "[door]:", "new", "b"]);
        // b's only link goes back up the file
        expect(headers(await added(text, { from: "section:b" }))).toEqual(["a", "[door]:", "b", "new"]);
    });

    test("after the +++ and --- sections that follow on from it", async () => {
        const text = "[[a]]:\nOne. [[b]]\n+++More\nTwo.\n---\nThree.\n\n[[b]]:\nEnd.\n+++Last\nReally.\n\n[[c]]:\nOther.";
        expect(headers(await added(text, { near: "section:a" }))).toEqual(["a", "+++More", "---", "new", "b", "+++Last", "c"]);
        // b is a's child, so a new one goes after b and what follows on from it
        expect(headers(await added(text, { from: "section:a" }))).toEqual(["a", "+++More", "---", "b", "+++Last", "new", "c"]);
        // Near (or from) a +++ section, it's the run it's part of
        expect(headers(await added(text, { near: "section:_continue1" }))).toEqual(["a", "+++More", "---", "new", "b", "+++Last", "c"]);
    });

    test("near a section, or a passage: after its section", async () => {
        expect(headers(await added(story, { near: "section:left" }))).toEqual(["start", "left", "new", "right", "end"]);
        const text = "[[a]]:\n[p]\n\n[p]:\nText.\n\n[[b]]:\nEnd.";
        expect(headers(await added(text, { near: "passage:a/p" }))).toEqual(["a", "[p]:", "new", "b"]);
    });

    test("with nothing to go by, or in another file, or after the master section: at the end", async () => {
        expect(headers(await added(story, {}))).toEqual(["start", "left", "right", "end", "new"]);
        const graph = await graphOf("[[]]:\nEvery time.\n\n[[a]]:\nGo to [[b]].\n", { "two.squiffy": "[[b]]:\nEnd.\n" });
        expect(placeNewSection(graph, { near: node(graph, "section:"), file: "story.squiffy" })).toEqual({ file: "story.squiffy" });
        expect(placeNewSection(graph, { from: node(graph, "section:a"), file: "two.squiffy" })).toEqual({ file: "two.squiffy" });
        // A link from another file doesn't make b a's child in this one
        expect(placeNewSection(graph, { from: node(graph, "section:a"), file: "story.squiffy" })).toEqual({ file: "story.squiffy", afterLine: 5 });
    });

    test("a new passage goes at the end of its section", async () => {
        const text = "[[a]]:\nLook at the [door].\n\n[door]:\nIt's a door.\n\n\n[[b]]:\nEnd.\n";
        const graph = await graphOf(text);
        const place = placeNewPassage(node(graph, "section:a"));
        expect(applyEditsToString(text, [insertHeaderEdit(text, place.afterLine, "[key]:")]))
            .toBe("[[a]]:\nLook at the [door].\n\n[door]:\nIt's a door.\n\n[key]:\n\n\n[[b]]:\nEnd.\n");
    });
});

describe("adding a header", () => {
    const add = (text: string, afterLine?: number) => applyEditsToString(text, [insertHeaderEdit(text, afterLine, "[[n]]:")]);

    test("at the end of a file, however it ends", () => {
        expect(add("[[a]]:\nText.")).toBe("[[a]]:\nText.\n\n[[n]]:\n");
        expect(add("[[a]]:\nText.\n")).toBe("[[a]]:\nText.\n\n[[n]]:\n");
        expect(add("[[a]]:\nText.\n\n\n")).toBe("[[a]]:\nText.\n\n[[n]]:\n\n\n");
    });

    test("in an empty file", () => {
        expect(add("")).toBe("[[n]]:\n");
        expect(add("\n\n")).toBe("[[n]]:\n\n\n");
    });

    test("in the middle, with a blank line either side", () => {
        expect(add("[[a]]:\nText.\n[[b]]:\nMore.", 1)).toBe("[[a]]:\nText.\n\n[[n]]:\n\n[[b]]:\nMore.");
        expect(add("[[a]]:\nText.\n\n[[b]]:\nMore.", 2)).toBe("[[a]]:\nText.\n\n[[n]]:\n\n[[b]]:\nMore.");
    });

    test("keeps Windows line endings", () => {
        expect(add("[[a]]:\r\nText.\r\n\r\n[[b]]:\r\nMore.\r\n", 2)).toBe("[[a]]:\r\nText.\r\n\r\n[[n]]:\r\n\r\n[[b]]:\r\nMore.\r\n");
    });
});

describe("a link with the header it links to", () => {
    const at = (line: number, character: number) => ({ range: { start: { line, character }, end: { line, character } }, newText: "[p]" });
    const apply = (text: string, link: ReturnType<typeof at>, afterLine?: number) => applyEditsToString(text, linkThenHeaderEdits(text, link, afterLine, "[p]:"));

    test("the header goes after the section's text, when the link's in it", () => {
        expect(apply("[[a]]:\nLook. \n\n[[b]]:\n", at(1, 6), 2)).toBe("[[a]]:\nLook. [p]\n\n[p]:\n\n[[b]]:\n");
    });

    test("and after the link, when that's on a blank line under the text", () => {
        // An empty section, with the cursor on the line under its header
        expect(apply("[[a]]:\n\n[[b]]:\n", at(1, 0), 1)).toBe("[[a]]:\n[p]\n\n[p]:\n\n[[b]]:\n");
        expect(apply("[[a]]:\n", at(1, 0), 1)).toBe("[[a]]:\n[p]\n\n[p]:\n");
        expect(apply("[[a]]:\nText.\n\n\n[[b]]:\n", at(3, 0), 3)).toBe("[[a]]:\nText.\n\n[p]\n\n[p]:\n\n[[b]]:\n");
    });
});

describe("deleting from the map", () => {
    const story = `[[start]]:
Go [[left]] or [[right]]. Look at the [sign] or the [sky].

[sign]:
It points [[left]].

[sky]:
Blue.

[[left]]:
[[Back]](start)
+++On
Further left.

[[right]]:
The end.
`;

    async function remove(text: string, ...ids: string[]) {
        const graph = await graphOf(text);
        const plan = planDeletion(graph, ids.map(id => node(graph, id)))!;
        return { plan, text: applyEditsToString(text, deleteLinesEdits(text, plan.ranges.get("story.squiffy")!)) };
    }

    test("a section goes with its passages, and the links to it are counted", async () => {
        const { plan, text } = await remove(story, "section:right");
        expect(text).toBe(story.replace("\n[[right]]:\nThe end.\n", ""));
        expect(plan).toMatchObject({ brokenLinks: 1, continuations: 0, passages: 0, start: false });
        expect(deletionMessage(plan)).toBe('Delete the section "right"? 1 link to it will be broken.');
    });

    test("a section goes with the sections that follow on from it", async () => {
        const { plan, text } = await remove(story, "section:left");
        expect(headers(text)).toEqual(["start", "[sign]:", "[sky]:", "right"]);
        // From start's own text and from its passage
        expect(plan).toMatchObject({ brokenLinks: 2, continuations: 1 });
        expect(deletionMessage(plan)).toBe('Delete the section "left"? So does the section that follows on from it (+++ or ---). 2 links to it will be broken.');
    });

    test("the start, with its passages", async () => {
        const { plan, text } = await remove(story, "section:start", "passage:start/sign");
        expect(headers(text)).toEqual(["left", "+++On", "right"]);
        expect(text.startsWith("[[left]]:")).toBe(true);
        expect(plan).toMatchObject({ brokenLinks: 1, passages: 2, start: true });
        expect(plan.chosen.map(n => n.id)).toEqual(["section:start"]);
        expect(deletionMessage(plan)).toBe('Delete the section "start"? Its 2 passages go too. 1 link to it will be broken. The story starts there, so it will start somewhere else.');
    });

    test("a passage", async () => {
        const { plan, text } = await remove(story, "passage:start/sign");
        expect(text).toBe(story.replace("[sign]:\nIt points [[left]].\n\n", ""));
        expect(deletionMessage(plan)).toBe('Delete the passage "sign"? 1 link to it will be broken.');
    });

    test("several at once, next to each other and at the end of the file", async () => {
        const { plan, text } = await remove(story, "section:left", "section:right", "passage:start/sky");
        expect(text).toBe("[[start]]:\nGo [[left]] or [[right]]. Look at the [sign] or the [sky].\n\n[sign]:\nIt points [[left]].\n");
        expect(deletionMessage(plan)).toBe("Delete 2 sections and 1 passage? So does the section that follows on from them (+++ or ---). 4 links to them will be broken.");
    });

    test("a link on a line of its own goes with what it links to", async () => {
        const text = "[[a]]:\nGo to [[b]].\n\n[[b]]\n\n[p]\n\n[p]:\nText.\n\n[[b]]:\nEnd. [[a]]\n";
        const graph = await graphOf(text);
        const texts = new Map([["story.squiffy", text]]);
        const plan = planDeletion(graph, [node(graph, "section:b"), node(graph, "passage:a/p")], texts)!;
        expect(plan).toMatchObject({ removedLinks: 2, brokenLinks: 1 });
        expect(applyEditsToString(text, deleteLinesEdits(text, plan.ranges.get("story.squiffy")!))).toBe("[[a]]:\nGo to [[b]].\n");
        expect(deletionMessage(plan)).toBe("Delete 1 section and 1 passage? The 2 links to them on lines of their own go too. 1 other link to them will be broken.");
        // One section, with only the link the map would have added
        const made = "[[a]]:\nStart.\n\n[[b]]\n\n[[b]]:\n";
        const madePlan = planDeletion(await graphOf(made), [node(await graphOf(made), "section:b")], new Map([["story.squiffy", made]]))!;
        expect(applyEditsToString(made, deleteLinesEdits(made, madePlan.ranges.get("story.squiffy")!))).toBe("[[a]]:\nStart.\n");
        expect(deletionMessage(madePlan)).toBe('Delete the section "b"? The link to it on a line of its own goes too.');
    });

    test("everything", async () => {
        expect((await remove("[[a]]:\nText.", "section:a")).text).toBe("");
    });

    test("not sections without names of their own, or the master section", async () => {
        const graph = await graphOf("Hello.\n\n[[]]:\nEvery time.\n\n[[a]]:\nOne.\n+++More\nTwo.");
        expect(planDeletion(graph, [node(graph, "section:_default"), node(graph, "section:"), node(graph, "section:_continue1")])).toBeUndefined();
        expect(blockOf(graph, node(graph, "section:_continue1")).map(s => s.name)).toEqual(["a", "_continue1"]);
    });
});

test("passage names", async () => {
    const graph = await graphOf("[[a]]:\n[p]\n\n[p]:\nText.\n\n[[b]]:\nEnd.");
    expect(checkPassageName("q", "a", graph)).toBeUndefined();
    expect(checkPassageName("p", "b", graph)).toBeUndefined();
    expect(checkPassageName("p", "a", graph)).toMatch(/already has/);
    expect(checkPassageName("@last", "a", graph)).toMatch(/run on their own/);
    expect(checkPassageName("a]b", "a", graph)).toMatch(/can't contain/);
    expect(checkPassageName(" ", "a", graph)).toMatch(/can't be empty/);
});

describe("starting the story at a section", () => {
    const set = (text: string) => applyEditsToString(text, [startEdit(text, "cave")]);

    test("changes @start, or adds it after @title", () => {
        expect(set("@title T\n@start hall\n\n[[hall]]:\n")).toBe("@title T\n@start cave\n\n[[hall]]:\n");
        expect(set("@title T\n\n[[hall]]:\n")).toBe("@title T\n@start cave\n\n[[hall]]:\n");
        expect(set("[[hall]]:\n")).toBe("@start cave\n[[hall]]:\n");
        expect(set("@title T")).toBe("@title T\n@start cave\n");
        expect(set("")).toBe("@start cave\n");
    });
});

describe("marking an ending", () => {
    test("adds @end under the section's header, or after it at the end of the file", async () => {
        const text = "[[a]]:\nGo [[b]].\n\n[[b]]:\nThe end.\n\n[[c]]:";
        const graph = await graphOf(text);
        const mark = (id: string) => applyEditsToString(text, [endingEdit(text, node(graph, id))]);
        expect(mark("section:b")).toBe("[[a]]:\nGo [[b]].\n\n[[b]]:\n@end\nThe end.\n\n[[c]]:");
        expect(mark("section:c")).toBe(text + "\n@end");
    });
});
