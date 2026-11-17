import { beforeAll, describe, expect, test, vi } from "vitest";

import { createLanguageService, ProjectFiles, WorkspaceEdit } from "./language-service.js";
import type { Position, Range } from "./syntax.js";

beforeAll(() => {
    vi.stubGlobal("crypto", {
        randomUUID: () => "00000000-0000-0000-0000-000000000000"
    });
});

function memoryFiles(files: Record<string, string>): ProjectFiles & { reads: string[] } {
    const reads: string[] = [];
    return {
        reads,
        list: async () => Object.keys(files).map(path => ({ path })),
        readText: async (path: string) => {
            reads.push(path);
            if (!(path in files)) throw new Error(`No file ${path}`);
            return files[path];
        },
    };
}

// The position of the first occurrence of `find` in `text`, plus `offset` characters
function positionOf(text: string, find: string, offset = 0): Position {
    const index = text.indexOf(find);
    if (index < 0) throw new Error(`"${find}" not found`);
    const before = text.substring(0, index + offset).split("\n");
    return { line: before.length - 1, character: before[before.length - 1].length };
}

function slice(text: string, range: Range) {
    const lines = text.split("\n");
    if (range.start.line == range.end.line) return lines[range.start.line].substring(range.start.character, range.end.character);
    return [lines[range.start.line].substring(range.start.character), ...lines.slice(range.start.line + 1, range.end.line), lines[range.end.line].substring(0, range.end.character)].join("\n");
}

// Applies edits to a file's text
function apply(text: string, edits: WorkspaceEdit[string]) {
    const lines = text.split("\n");
    const offset = (p: Position) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
    const sorted = [...edits].sort((a, b) => offset(b.range.start) - offset(a.range.start));
    for (const edit of sorted) {
        text = text.substring(0, offset(edit.range.start)) + edit.newText + text.substring(offset(edit.range.end));
    }
    return text;
}

const main = `@title The Cellar
@import chapters/*.squiffy

[[start]]:
@set visited
You're at the top of the stairs. Go [[down]](cellar, light=1) or [look around].
{{embed "notes"}}

[look around]:
Dust everywhere. [[Onward>]]

[notes]:
Some notes.

[[outside]]:
Fresh air. Back to [[start]].
`;

const cellar = `[[cellar]]:
@inc steps 3
It's dark. [[Go back up]](start) or [search].

[search]:
You find [[a key]](missing room).
{{embed "start"}}

[snippet: description]:
A damp cellar.
`;

const project = () => {
    const files = memoryFiles({ "story.squiffy": main, "chapters/cellar.squiffy": cellar, "notes.txt": "x" });
    return { files, ls: createLanguageService({ files, mainFile: "story.squiffy" }) };
};

describe("diagnostics", () => {
    test("for each file, pointing at the link", async () => {
        const { ls } = project();
        expect(await ls.getDiagnostics("story.squiffy")).toEqual([]);
        const diagnostics = await ls.getDiagnostics("chapters/cellar.squiffy");
        expect(diagnostics.map(d => [d.code, slice(cellar, d.range)])).toEqual([
            ["squiffy/unknown-section-link", "[[a key]](missing room)"],
        ]);
    });

    test("keep coming after an error", async () => {
        const files = memoryFiles({ "s.squiffy": "[orphan]:\ntext\n\n[[a]]:\n[[nowhere]]" });
        const ls = createLanguageService({ files, mainFile: "s.squiffy" });
        expect((await ls.getDiagnostics("s.squiffy")).map(d => d.code)).toEqual([
            "squiffy/passage-without-section",
            "squiffy/unknown-section-link",
        ]);
        expect((await ls.getAnalysis()).success).toBe(false);
    });

    test("use open files over the project, and only reparse what changed", async () => {
        const { ls, files } = project();
        const before = await ls.getAnalysis();
        ls.updateFile("story.squiffy", main.replace("[[start]].", "[[startt]]."));
        const after = await ls.getAnalysis();
        expect((await ls.getDiagnostics("story.squiffy")).map(d => d.code)).toEqual(["squiffy/unknown-section-link"]);
        // The imported file's tree is reused, and it isn't read again
        expect(after.files[1]).toBe(before.files[1]);
        expect(files.reads.filter(r => r == "chapters/cellar.squiffy").length).toBe(1);

        ls.updateFile("story.squiffy", undefined);
        expect(await ls.getDiagnostics("story.squiffy")).toEqual([]);
    });

    test("for a section or passage defined twice, at the later name", async () => {
        const main = "[[a]]:\n[p]:\nx\n[p]:\ny\n@import b.squiffy";
        const b = "[[a]]:\n@end\nagain";
        const ls = createLanguageService({ files: memoryFiles({ "s.squiffy": main, "b.squiffy": b }), mainFile: "s.squiffy" });
        expect((await ls.getDiagnostics("s.squiffy")).map(d => [d.code, d.severity, slice(main, d.range)])).toEqual([
            ["squiffy/duplicate-passage", "warning", "p"],
        ]);
        const diagnostics = await ls.getDiagnostics("b.squiffy");
        expect(diagnostics.map(d => [d.code, d.severity, slice(b, d.range), d.message])).toEqual([
            ["squiffy/duplicate-section", "warning", "a", "There's already a section called [[a]], at s.squiffy line 1. This one replaces it."],
        ]);
    });

    test("pick up changes to project files", async () => {
        const data: Record<string, string> = { "s.squiffy": "[[a]]:\n@import b.squiffy\n[[b]]", "b.squiffy": "[[b]]:\n[[c]]" };
        const ls = createLanguageService({ files: memoryFiles(data), mainFile: "s.squiffy" });
        expect((await ls.getDiagnostics("b.squiffy")).length).toBe(1);
        data["b.squiffy"] = "[[b]]:\n[[a]]";
        ls.fileChanged("b.squiffy");
        expect(await ls.getDiagnostics("b.squiffy")).toEqual([]);
    });
});

describe("document symbols", () => {
    test("title, sections, passages and snippets", async () => {
        const { ls } = project();
        const symbols = await ls.getDocumentSymbols("story.squiffy");
        expect(symbols.map(s => [s.kind, s.name, s.children.map(c => c.name)])).toEqual([
            ["title", "The Cellar", []],
            ["section", "start", ["look around", "notes"]],
            ["section", "outside", []],
        ]);
        expect(slice(main, symbols[1].selectionRange)).toBe("start");

        const cellarSymbols = await ls.getDocumentSymbols("chapters/cellar.squiffy");
        expect(cellarSymbols.map(s => [s.kind, s.name])).toEqual([["section", "cellar"], ["snippet", "description"]]);
    });

    test("unnamed sections", async () => {
        const text = "Intro text\n+++Next\nMore\n---\nEnd";
        const ls = createLanguageService({ files: memoryFiles({ "s.squiffy": text }), mainFile: "s.squiffy" });
        expect((await ls.getDocumentSymbols("s.squiffy")).map(s => [s.name, s.detail])).toEqual([
            ["_default", "(Start)"],
            ["_continue1", "+++Next"],
            ["_continue2", "---"],
        ]);
    });

    test("work for files that aren't imported", async () => {
        const files = memoryFiles({ "s.squiffy": "[[a]]:", "other.squiffy": "[[b]]:\n[p]:" });
        const ls = createLanguageService({ files, mainFile: "s.squiffy" });
        expect((await ls.getDocumentSymbols("other.squiffy")).map(s => [s.name, s.children.map(c => c.name)])).toEqual([["b", ["p"]]]);
    });
});

describe("definition and references", () => {
    test("section link in another file", async () => {
        const { ls } = project();
        const definition = await ls.getDefinition("story.squiffy", positionOf(main, "[[down]](cellar", 10));
        expect(definition?.file).toBe("chapters/cellar.squiffy");
        expect(slice(cellar, definition!.range)).toBe("cellar");
    });

    test("passage link, embed and next-section link", async () => {
        const { ls } = project();
        let definition = await ls.getDefinition("story.squiffy", positionOf(main, "[look around].", 2));
        expect(definition?.file).toBe("story.squiffy");
        expect(definition!.range.start.line).toBe(positionOf(main, "[look around]:").line);

        definition = await ls.getDefinition("story.squiffy", positionOf(main, "{{embed", 10));
        expect(definition!.range.start.line).toBe(positionOf(main, "[notes]:").line);

        // The @import comes before [[start]], so the story's sections are cellar, start, outside,
        // and [[Onward>]] in start goes to outside
        definition = await ls.getDefinition("story.squiffy", positionOf(main, "[[Onward>]]", 3));
        expect(slice(main, definition!.range)).toBe("outside");

        // An embed of a section from the other file
        definition = await ls.getDefinition("chapters/cellar.squiffy", positionOf(cellar, "{{embed \"start\"", 3));
        expect(definition?.file).toBe("story.squiffy");
        expect(slice(main, definition!.range)).toBe("start");
    });

    test("nothing for a broken link", async () => {
        const { ls } = project();
        expect(await ls.getDefinition("chapters/cellar.squiffy", positionOf(cellar, "missing room"))).toBeUndefined();
    });

    test("references across files, from a link or a header", async () => {
        const { ls } = project();
        const fromHeader = await ls.getReferences("story.squiffy", positionOf(main, "[[start]]:", 3));
        expect(fromHeader.map(r => [r.file, r.range.start.line])).toEqual([
            ["story.squiffy", 3],
            ["story.squiffy", 15],
            ["chapters/cellar.squiffy", 2],
            ["chapters/cellar.squiffy", 6],
        ]);
        const fromLink = await ls.getReferences("chapters/cellar.squiffy", positionOf(cellar, "(start)", 2), false);
        expect(fromLink.length).toBe(3);
    });
});

describe("rename", () => {
    test("a section, everywhere it's linked, keeping setters", async () => {
        const { ls } = project();
        const result = await ls.getRenameEdits("chapters/cellar.squiffy", positionOf(cellar, "[[cellar]]:", 3), "basement");
        if (!result || "error" in result) throw new Error("Expected edits");
        expect(apply(cellar, result.edit["chapters/cellar.squiffy"])).toContain("[[basement]]:");
        expect(apply(main, result.edit["story.squiffy"])).toContain("Go [[down]](basement, light=1)");
    });

    test("a passage, including embeds", async () => {
        const { ls } = project();
        const result = await ls.getRenameEdits("story.squiffy", positionOf(main, "[notes]:", 2), "jottings");
        if (!result || "error" in result) throw new Error("Expected edits");
        const renamed = apply(main, result.edit["story.squiffy"]);
        expect(renamed).toContain("{{embed \"jottings\"}}");
        expect(renamed).toContain("[jottings]:");
    });

    test("an unnamed link changes its text, which is its target", async () => {
        const { ls } = project();
        const result = await ls.getRenameEdits("story.squiffy", positionOf(main, "[[outside]]:", 3), "garden");
        if (!result || "error" in result) throw new Error("Expected edits");
        expect(Object.keys(result.edit)).toEqual(["story.squiffy"]);
        const startResult = await ls.getRenameEdits("story.squiffy", positionOf(main, "[[start]]:", 3), "top");
        if (!startResult || "error" in startResult) throw new Error("Expected edits");
        expect(apply(main, startResult.edit["story.squiffy"])).toContain("Back to [[top]].");
        expect(apply(cellar, startResult.edit["chapters/cellar.squiffy"])).toContain("[[Go back up]](top)");
    });

    test("refuses bad names and clashes", async () => {
        const { ls } = project();
        const at = positionOf(main, "[[outside]]:", 3);
        expect(await ls.getRenameEdits("story.squiffy", at, "start")).toEqual({ error: "There's already a section called 'start'." });
        expect(await ls.getRenameEdits("story.squiffy", at, "a, b")).toHaveProperty("error");
        expect(await ls.getRenameEdits("story.squiffy", at, "")).toHaveProperty("error");
        expect(await ls.getRenameEdits("story.squiffy", { line: 0, character: 0 }, "x")).toBeUndefined();
    });
});

describe("completion", () => {
    const complete = async (text: string, cursor: string) => {
        const files = memoryFiles({ "story.squiffy": main, "chapters/cellar.squiffy": cellar });
        const ls = createLanguageService({ files, mainFile: "story.squiffy" });
        const edited = main.replace("Fresh air.", `Fresh air. ${text}`);
        ls.updateFile("story.squiffy", edited);
        const position = positionOf(edited, "Fresh air. " + text + cursor, "Fresh air. ".length + text.length);
        return ls.getCompletions("story.squiffy", position);
    };

    test("section names after [[ and ](", async () => {
        const items = await complete("[[ce", "");
        expect(items.map(i => i.label)).toEqual(["cellar", "start", "outside"]);
        expect(items[0].range.end.character - items[0].range.start.character).toBe(2);
        expect((await complete("[[Go]](o", "")).map(i => i.label)).toEqual(["cellar", "start", "outside"]);
    });

    test("passage names after [ in the current section", async () => {
        const files = memoryFiles({ "s.squiffy": "[[a]]:\nSee [\n[p1]:\n[@last]:\n[[b]]:\n[q]:" });
        const ls = createLanguageService({ files, mainFile: "s.squiffy" });
        const items = await ls.getCompletions("s.squiffy", { line: 1, character: 5 });
        expect(items.map(i => i.label)).toEqual(["p1"]);
    });

    test("embed names", async () => {
        // In the outside section, which has no passages
        const labels = (await complete("{{embed \"", "")).map(i => i.label);
        expect(labels).toEqual(["cellar", "start", "outside"]);
    });

    test("attribute names", async () => {
        const files = memoryFiles({ "s.squiffy": "[[a]]:\n@set score=1\n    squiffy.set(\"gold\", 2);\n[[b]](a, not seen)\n@inc " });
        const ls = createLanguageService({ files, mainFile: "s.squiffy" });
        const items = await ls.getCompletions("s.squiffy", { line: 4, character: 5 });
        expect(items.map(i => i.label)).toEqual(["gold", "score", "seen"]);
    });

    test("nothing in a section, passage or snippet header, which names something new", async () => {
        const files = memoryFiles({ "s.squiffy": "[[a]]:\nSee [p1].\n[my pass]:\n[[new sect]]:\n[snippet:greet]:\nHi" });
        const ls = createLanguageService({ files, mainFile: "s.squiffy" });
        expect(await ls.getCompletions("s.squiffy", { line: 2, character: 8 })).toEqual([]);
        expect(await ls.getCompletions("s.squiffy", { line: 3, character: 10 })).toEqual([]);
        expect(await ls.getCompletions("s.squiffy", { line: 4, character: 14 })).toEqual([]);
        // A link is still completed
        expect((await ls.getCompletions("s.squiffy", { line: 1, character: 7 })).map(i => i.label)).toEqual(["my pass"]);
    });

    test("snippets at the start of a line", async () => {
        const items = await complete("\nde", "");
        expect(items).toMatchObject([{ label: "description", kind: "snippet", insertText: "A damp cellar." }]);
    });
});

describe("hover, folding and section at position", () => {
    test("hover shows the start of the linked section", async () => {
        const { ls } = project();
        const hover = await ls.getHover("story.squiffy", positionOf(main, "[[down]]", 3));
        expect(hover?.contents).toBe("**[[cellar]]**\n\nIt's dark. [[Go back up]](start) or [search].");
        expect(slice(main, hover!.range)).toBe("[[down]](cellar, light=1)");
    });

    test("folding ranges for sections, passages and snippets", async () => {
        const { ls } = project();
        expect(await ls.getFoldingRanges("chapters/cellar.squiffy")).toEqual([
            { startLine: 0, endLine: 6 },
            { startLine: 4, endLine: 6 },
            { startLine: 8, endLine: 9 },
        ]);
    });

    test("section at position", async () => {
        const { ls } = project();
        expect(await ls.getSectionAt("story.squiffy", positionOf(main, "Dust"))).toEqual({ section: "start", passage: "look around" });
        expect(await ls.getSectionAt("story.squiffy", positionOf(main, "Fresh"))).toEqual({ section: "outside" });
        expect(await ls.getSectionAt("chapters/cellar.squiffy", positionOf(cellar, "A damp"))).toBeUndefined();
    });
});

describe("code actions", () => {
    test("create a missing section", async () => {
        const { ls } = project();
        const diagnostic = (await ls.getDiagnostics("chapters/cellar.squiffy"))[0];
        const actions = await ls.getCodeActions("chapters/cellar.squiffy", diagnostic.range);
        expect(actions.map(a => a.title)).toEqual(["Create section 'missing room'"]);
        expect(apply(cellar, actions[0].edit["chapters/cellar.squiffy"])).toBe(cellar + "\n[[missing room]]:\n");
    });

    test("create a missing passage", async () => {
        const text = "[[a]]:\nSee [p].\n\n[[b]]:\nB";
        const ls = createLanguageService({ files: memoryFiles({ "s.squiffy": text }), mainFile: "s.squiffy" });
        const diagnostic = (await ls.getDiagnostics("s.squiffy"))[0];
        const actions = await ls.getCodeActions("s.squiffy", diagnostic.range);
        expect(actions[0].title).toBe("Create passage 'p'");
        expect(apply(text, actions[0].edit["s.squiffy"])).toBe("[[a]]:\nSee [p].\n[p]:\n\n[[b]]:\nB");
    });

    test("convert Squiffy 5 syntax", async () => {
        const text = "[[a]]:\nHello {name}, {if x:yes}.";
        const ls = createLanguageService({ files: memoryFiles({ "s.squiffy": text }), mainFile: "s.squiffy" });
        const diagnostics = await ls.getDiagnostics("s.squiffy");
        const actions = await ls.getCodeActions("s.squiffy", diagnostics[0].range);
        expect(actions.map(a => a.title)).toEqual(["Convert to {{name}}", "Convert all Squiffy 5 syntax in this file"]);
        expect(apply(text, actions[0].edit["s.squiffy"])).toBe("[[a]]:\nHello {{name}}, {if x:yes}.");
        expect(apply(text, actions[1].edit["s.squiffy"])).not.toContain("{if");
    });
});

describe("folder mode, with a squiffy.json", () => {
    const folder = (extra: Record<string, string> = {}) => {
        const data: Record<string, string> = {
            "squiffy.json": "{ \"version\": 1, \"main\": \"story.squiffy\", \"exclude\": [\"drafts/**\"] }",
            "story.squiffy": "@title Folder\n@import b.squiffy\n\n[[start]]:\nGo to [[a]] or [[b]].",
            "a.squiffy": "@title Not this\n[[a]]:\n@end\nA",
            "b.squiffy": "[[b]]:\n@end\nB",
            "drafts/c.squiffy": "[[c]]:\nC",
            ...extra,
        };
        const files = memoryFiles(data);
        // The main file given here is overridden by squiffy.json
        return { data, ls: createLanguageService({ files, mainFile: "other.squiffy" }) };
    };

    test("every .squiffy file not excluded is part of the story", async () => {
        const { ls } = folder();
        expect(await ls.getProjectInfo()).toEqual({
            projectFile: { version: 1, main: "story.squiffy", exclude: ["drafts/**"] },
            mainFile: "story.squiffy",
            storyFiles: ["a.squiffy", "b.squiffy"],
            excludedFiles: ["drafts/c.squiffy"],
        });
        const analysis = await ls.getAnalysis();
        expect(analysis.success).toBe(true);
        expect(analysis.files.map(f => f.filename)).toEqual(["story.squiffy", "b.squiffy", "a.squiffy"]);
        expect(analysis.sections.map(s => s.name)).toEqual(["b", "start", "a"]);
    });

    test("warnings for @title outside the main file, and a quick fix for an @import that isn't needed", async () => {
        const { ls, data } = folder();
        expect((await ls.getDiagnostics("a.squiffy")).map(d => [d.code, d.severity])).toEqual([
            ["squiffy/not-in-main-file", "warning"],
        ]);
        const [hint] = await ls.getDiagnostics("story.squiffy");
        expect([hint.code, hint.severity, hint.range.start.line]).toEqual(["squiffy/redundant-import", "hint", 1]);
        const [action] = await ls.getCodeActions("story.squiffy", hint.range);
        expect(action.title).toBe("Remove this @import");
        expect(apply(data["story.squiffy"], action.edit["story.squiffy"])).toBe("@title Folder\n\n[[start]]:\nGo to [[a]] or [[b]].");
    });

    test("an excluded file isn't part of the story, but can still be opened", async () => {
        const { ls } = folder();
        expect(await ls.getDiagnostics("drafts/c.squiffy")).toEqual([]);
        expect((await ls.getDocumentSymbols("drafts/c.squiffy")).map(s => s.name)).toEqual(["c"]);
        expect((await ls.getAnalysis()).sections.some(s => s.name == "c")).toBe(false);
    });

    test("follows changes to squiffy.json and new files", async () => {
        const { ls, data } = folder();
        data["squiffy.json"] = "{ \"version\": 1, \"main\": \"story.squiffy\" }";
        ls.fileChanged("squiffy.json");
        expect((await ls.getProjectInfo()).storyFiles).toEqual(["a.squiffy", "b.squiffy", "drafts/c.squiffy"]);
        ls.updateFile("d.squiffy", "[[d]]:\n");
        expect((await ls.getProjectInfo()).storyFiles).toContain("d.squiffy");
        ls.updateFile("squiffy.json", "{ \"version\": 1, \"main\": \"a.squiffy\" }");
        expect((await ls.getProjectInfo()).mainFile).toBe("a.squiffy");
        expect((await ls.getAnalysis()).sections[0].name).toBe("a");
    });

    test("a broken squiffy.json is an error, and the main file falls back to the one given", async () => {
        const { ls } = folder({ "squiffy.json": "{ \"version\": 9, \"main\": \"story.squiffy\" }", "other.squiffy": "[[o]]:\n" });
        const info = await ls.getProjectInfo();
        expect(info.projectFile).toBeUndefined();
        expect(info.mainFile).toBe("other.squiffy");
        expect(info.error).toBe("This story's squiffy.json is version 9, which needs a newer version of Squiffy.");
        expect((await ls.getDiagnostics("squiffy.json")).map(d => [d.code, d.severity])).toEqual([["squiffy/project-file", "error"]]);
        expect((await ls.getAnalysis()).success).toBe(false);
    });

    test("without squiffy.json, other files need an @import", async () => {
        const ls = createLanguageService({ files: memoryFiles({ "s.squiffy": "[[s]]:\n", "t.squiffy": "[[t]]:\n" }), mainFile: "s.squiffy" });
        expect(await ls.getProjectInfo()).toEqual({ mainFile: "s.squiffy", storyFiles: [], excludedFiles: [] });
        expect((await ls.getAnalysis()).sections.map(s => s.name)).toEqual(["s"]);
    });
});
