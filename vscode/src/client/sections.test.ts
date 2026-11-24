import { describe, expect, test } from "vitest";
import { createLanguageService } from "squiffy-compiler/language-service";
import { parentsOf, sectionsTree, startAt, type NodeItem, type SectionsItem } from "./sections.js";

async function graphOf(files: Record<string, string>) {
    const service = createLanguageService({
        mainFile: "story.squiffy",
        files: { list: async () => Object.keys(files).map(path => ({ path })), readText: async path => files[path] },
    });
    return service.getStoryGraph();
}

// Each item as "label (description)", with its children
function outline(items: SectionsItem[]): unknown[] {
    return items.map(item => {
        const name = item.kind == "file" ? `file ${item.file}` : item.description ? `${item.label} (${item.description})` : item.label;
        return item.children.length ? { [name]: outline(item.children) } : name;
    });
}

const story = `[[start]]:
Go [[left]] or [[right]], or [look].

[look]:
Nothing.

[[left]]:
@end
Left.

[[right]]:
Stuck.

[[lost]]:
Nothing links here. [[start]]
`;

describe("the Sections view", () => {
    test("lists sections with their passages, marked as on the map", async () => {
        const items = sectionsTree(await graphOf({ "story.squiffy": story }), "story.squiffy");
        expect(outline(items)).toEqual([
            { "start (start)": ["look"] },
            "left (ending)",
            "right (dead end)",
            "lost (unreachable)",
        ]);
        const right = items[2] as NodeItem;
        expect(right.tooltip).toContain("A dead end");
    });

    test("groups sections by file when there's more than one, the main file first", async () => {
        const items = sectionsTree(await graphOf({
            "story.squiffy": "@import chapters/b.squiffy\n@import a.squiffy\n\n[[start]]:\n[[one]] [[two]]",
            "a.squiffy": "[[two]]:\n@end",
            "chapters/b.squiffy": "[[one]]:\n@end",
        }), "story.squiffy");
        expect(outline(items)).toEqual([
            { "file story.squiffy": ["start (start)"] },
            { "file a.squiffy": ["two (ending)"] },
            { "file chapters/b.squiffy": ["one (ending)"] },
        ]);
        const parents = parentsOf(items);
        expect(parents.get("section:one")?.id).toBe("file:chapters/b.squiffy");
    });

    test("the master section has no marks, and the preview can't start there", async () => {
        const items = sectionsTree(await graphOf({ "story.squiffy": "[[]]:\nEvery section.\n\n[@last]:\nThe end.\n\n[[start]]:\n@end\nHello." }), "story.squiffy");
        expect(outline(items)).toEqual([
            { "Master section (part of every section)": ["@last"] },
            "start (start, ending)",
        ]);
        const [master, start] = items as NodeItem[];
        expect(startAt(master)).toBeUndefined();
        expect(startAt(master.children[0])).toBeUndefined();
        expect(startAt(start)).toEqual({ section: "start" });
    });

    test("a passage starts the preview in its section", async () => {
        const [start] = sectionsTree(await graphOf({ "story.squiffy": story }), "story.squiffy") as NodeItem[];
        expect(startAt(start.children[0])).toEqual({ section: "start", passage: "look" });
    });

    test("a section for testing isn't called unreachable", async () => {
        const items = sectionsTree(await graphOf({ "story.squiffy": "[[start]]:\n@end\nHi.\n\n[[scene]]:\n@test\n[[start]]" }), "story.squiffy");
        expect(outline(items)).toEqual(["start (start, ending)", "scene (test)"]);
    });
});
