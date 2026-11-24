import { describe, expect, test } from "vitest";
import { createLanguageService, type TextEdit } from "squiffy-compiler/language-service";
import { addPassageEdits, linkEdit, movedPositions } from "./map-edits.js";

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

test("dropped sections and passages are kept by name, and markers aren't kept", async () => {
    const graph = await graphOf(story);
    const positions = movedPositions(graph, { sections: { left: [1, 2] }, passages: {} }, [
        { id: "section:start", at: { x: 10.4, y: 20.6 } },
        { id: "passage:start/look", at: { x: 5, y: 6 } },
        { id: "missing:whatever", at: { x: 0, y: 0 } },
    ]);
    expect(positions).toEqual({ sections: { left: [1, 2], start: [10, 21] }, passages: { start: { look: [5, 6] } } });
});
