import { describe, expect, test } from "vitest";
import { createLanguageService, type TextEdit } from "squiffy-compiler/language-service";
import { addPassageEdits, linkEdit, linkEndsEnding, missingTarget, movedPositions, newPassageEdit, newSectionEdits, textStart } from "./map-edits.js";

async function graphOf(text: string) {
    const files: Record<string, string> = { "story.squiffy": text };
    const service = createLanguageService({
        mainFile: "story.squiffy",
        files: { list: async () => Object.keys(files).map(path => ({ path })), readText: async path => files[path] },
    });
    return service.getStoryGraph();
}

// The text with an edit made
function apply(text: string, edit: TextEdit) {
    const lines = text.split("\n");
    const offset = (p: { line: number; character: number }) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
    return text.slice(0, offset(edit.range.start)) + edit.newText + text.slice(offset(edit.range.end));
}

const story = `[[start]]:
Go [[left]].

[look]:
Nothing.

[[left]]:
Left.

[[right]]:
`;

describe("linking on the map", () => {
    test("a link goes after the section's own text, before its passages", async () => {
        const result = linkEdit(await graphOf(story), "section:start", "section:right");
        expect(result).toMatchObject({ file: "story.squiffy" });
        if ("error" in result) return;
        expect(apply(story, result.edit)).toContain("Go [[left]].\n\n[[right]]\n\n[look]:");
    });

    test("a link from a section with only a header goes on the next line", async () => {
        const result = linkEdit(await graphOf(story), "section:right", "section:left");
        if ("error" in result) throw new Error(result.error);
        expect(apply(story, result.edit)).toMatch(/\[\[right\]\]:\n\[\[left\]\]\n$/);
    });

    test("a link goes at the cursor, if it's in the section the link is from", async () => {
        const graph = await graphOf(story);
        const inStart = linkEdit(graph, "section:start", "passage:start/look", { file: "story.squiffy", position: { line: 1, character: 3 } });
        if ("error" in inStart) throw new Error(inStart.error);
        expect(apply(story, inStart.edit)).toContain("Go [look][[left]].");
        // On its header, or in another section, it goes after its text
        const onHeader = linkEdit(graph, "section:start", "section:right", { file: "story.squiffy", position: { line: 0, character: 3 } });
        const elsewhere = linkEdit(graph, "section:start", "section:right", { file: "story.squiffy", position: { line: 7, character: 0 } });
        const after = linkEdit(graph, "section:start", "section:right");
        expect(onHeader).toEqual(after);
        expect(elsewhere).toEqual(after);
    });

    test("a link isn't typed into a directive line at the cursor, such as @end", async () => {
        const text = "[[start]]:\n@end\nThe end.\n\n[[left]]:\nLeft.";
        const graph = await graphOf(text);
        const cursor = { file: "story.squiffy", position: { line: 1, character: 0 }, lineText: "@end" };
        expect(linkEdit(graph, "section:start", "section:left", cursor)).toEqual(linkEdit(graph, "section:start", "section:left"));
    });

    test("a link from an ending to another section takes out its @end, but not one back to the start", async () => {
        const text = "[[start]]:\nGo [[end]].\n\n[[end]]:\n@end\nThe end.\n\n[[more]]:\nMore.";
        const graph = await graphOf(text);
        const end = graph.nodes.find(n => n.id == "section:end")!;
        expect(linkEndsEnding(graph, end, "section:more", text).map(e => e.range.start.line)).toEqual([3]);
        expect(linkEndsEnding(graph, end, undefined, text)).toHaveLength(1);
        expect(linkEndsEnding(graph, end, "section:start", text)).toEqual([]);
    });

    test("says why there can't be a link", async () => {
        const graph = await graphOf(story);
        expect(linkEdit(graph, "section:left", "passage:start/look")).toEqual({ error: "A passage can only be linked to from its own section." });
        expect(linkEdit(graph, "section:left", "section:gone")).toEqual({ error: "The story has changed. Try again." });
    });
});

test("a passage goes at the end of its section, with a link to it after the section's text", async () => {
    const graph = await graphOf(story);
    const start = graph.nodes.find(n => n.id == "section:start")!;
    const result = addPassageEdits(graph, start, "listen", story);
    if (!result) throw new Error("No edits");
    expect(result.file).toBe("story.squiffy");
    const text = [...result.edits].reverse().reduce(apply, story);
    expect(text).toContain("Go [[left]].\n\n[listen]\n\n[look]:\nNothing.\n\n[listen]:\n\n[[left]]:");
});

describe("making sections and passages on the map", () => {
    const applyAll = (text: string, edits: TextEdit[]) => [...edits].reverse().reduce(apply, text);

    test("a section linked from another goes after the ones it already leads to, with the link after its text", async () => {
        const graph = await graphOf(story);
        const start = graph.nodes.find(n => n.id == "section:start")!;
        const text = applyAll(story, newSectionEdits(graph, "down", { from: start, file: "story.squiffy" }, story));
        expect(text).toContain("Go [[left]].\n\n[[down]]\n\n[look]:");
        expect(text).toContain("[[left]]:\nLeft.\n\n[[down]]:\n\n[[right]]:");
    });

    test("a section made near another goes after it, without a link", async () => {
        const graph = await graphOf(story);
        const left = graph.nodes.find(n => n.id == "section:left")!;
        const text = applyAll(story, newSectionEdits(graph, "up", { near: left, file: "story.squiffy" }, story));
        expect(text).toBe(story.replace("Left.\n", "Left.\n\n[[up]]:\n"));
    });

    test("what a broken link is missing is made without another link to it", async () => {
        const broken = "[[start]]:\nGo [[nowhere]] or [here].\n";
        const graph = await graphOf(broken);
        const edges = graph.edges.filter(e => !e.to);
        const section = missingTarget(graph, edges.find(e => e.kind == "section-link")!);
        const passage = missingTarget(graph, edges.find(e => e.kind == "passage-link")!);
        expect(section).toMatchObject({ kind: "section", name: "nowhere" });
        expect(passage).toMatchObject({ kind: "passage", name: "here" });
        expect(applyAll(broken, newSectionEdits(graph, "nowhere", { from: section!.from, link: false, file: "story.squiffy" }, broken)))
            .toBe(`${broken}\n[[nowhere]]:\n`);
        const { edit } = newPassageEdit(passage!.from, "here", broken);
        expect(apply(broken, edit)).toBe(`${broken}\n[here]:\n`);
    });
});

test("dropped sections and passages are kept by name, and markers aren't kept", async () => {
    const graph = await graphOf(story);
    const positions = movedPositions(graph, { sections: { left: [1, 2] }, passages: {} }, [
        { id: "section:start", at: { x: 10.4, y: 20.6 } },
        { id: "passage:start/look", at: { x: 5, y: 6 } },
        { id: "missing:whatever", at: { x: 0, y: 0 } },
    ]);
    expect(positions).toEqual({ sections: { left: [1, 2], start: [10, 21] }, passages: { start: { look: [5, 6] } } });
});

describe("where to start typing in a box opened from the map", () => {
    const lines = ["[[a]]:", "@set x", "@end", "Text of a.", "", "[p]:", "Passage.", "", "[[empty]]:", "", "[[last]]:", "@end"];

    test("the start of its text, past its @ lines", () => {
        expect(textStart(lines, 0)).toEqual({ line: 3, character: 0 });
        expect(textStart(lines, 5)).toEqual({ line: 6, character: 0 });
    });

    test("a blank line under a section with no text, ready to write on", () => {
        expect(textStart(lines, 8)).toEqual({ line: 9, character: 0 });
    });

    test("with nothing after it, the end of its last line", () => {
        expect(textStart(lines, 10)).toEqual({ line: 11, character: 4 });
        expect(textStart(["[[a]]:", "[[b]]:"], 0)).toEqual({ line: 0, character: 6 });
    });
});
