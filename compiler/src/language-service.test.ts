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

    test("for the whole project at once", async () => {
        const { ls } = project();
        ls.updateFile("story.squiffy", main.replace("[[start]].", "[[startt]]."));
        expect((await ls.getAllDiagnostics()).map(d => [d.file, d.code])).toEqual([
            ["chapters/cellar.squiffy", "squiffy/unknown-section-link"],
            ["story.squiffy", "squiffy/unknown-section-link"],
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

    test("for text that's unchanged by an edit, in the right place", async () => {
        // Each section's Handlebars check is kept between analyses, as text it's seen before
        const text = "[[a]]:\nSome {{#if x}}text.\n\n[[b]]:\nHello {{who}}.";
        const files = memoryFiles({ "s.squiffy": text });
        const ls = createLanguageService({ files, mainFile: "s.squiffy" });
        const problems = async (text: string) => (await ls.getDiagnostics("s.squiffy"))
            .filter(d => d.code == "squiffy/template-syntax" || d.code == "squiffy/unknown-name")
            .map(d => [d.code, d.range.start.line, slice(text, d.range)]);
        expect(await problems(text)).toEqual([
            ["squiffy/template-syntax", 1, "{{#if x}}"],
            ["squiffy/unknown-name", 4, "{{who}}"],
        ]);

        const moved = "[[a]]:\nFirst.\n\nSome {{#if x}}text.\n\n[[b]]:\nHello {{who}}.";
        ls.updateFile("s.squiffy", moved);
        expect(await problems(moved)).toEqual([
            ["squiffy/template-syntax", 3, "{{#if x}}"],
            ["squiffy/unknown-name", 6, "{{who}}"],
        ]);

        const fixed = moved.replace("text.", "text.{{/if}}");
        ls.updateFile("s.squiffy", fixed);
        expect(await problems(fixed)).toEqual([["squiffy/unknown-name", 6, "{{who}}"]]);
    });

    test("for a section or passage defined twice, at the later name", async () => {
        const main = "[[a]]:\n[p]:\nx\n[p]:\ny\n@import b.squiffy";
        const b = "[[a]]:\n@end\nagain";
        const ls = createLanguageService({ files: memoryFiles({ "s.squiffy": main, "b.squiffy": b }), mainFile: "s.squiffy" });
        expect((await ls.getDiagnostics("s.squiffy")).map(d => [d.code, d.severity, slice(main, d.range), d.message])).toEqual([
            ["squiffy/duplicate-passage", "warning", "p", "There's already a passage called [p] in section 'a', at line 2. This one replaces it."],
            // The section that's replaced says so too
            ["squiffy/duplicate-section", "warning", "a", "The section [[a]] at b.squiffy line 1 replaces this one, so this section and its passages aren't part of the story. Rename one of them."],
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

    describe("template syntax errors", () => {
        const templateErrors = async (text: string) => {
            const ls = createLanguageService({ files: memoryFiles({ "s.squiffy": text }), mainFile: "s.squiffy" });
            return (await ls.getDiagnostics("s.squiffy"))
                .filter(d => d.code == "squiffy/template-syntax")
                .map(d => [d.severity, slice(text, d.range), d.message]);
        };

        test("an expression in a plain {{...}}", async () => {
            const text = "[[start]]:\nThe words.\n\"Round {{round + 1}}, {{player_name}}.\"\n[[Next]](next)\n\n[[next]]:\nEnd.";
            expect(await templateErrors(text)).toEqual([[
                "error", "{{round + 1}}",
                "In section 'start', {{round + 1}} isn't valid Handlebars. To show the result of an expression, start it with \"=\": {{= round + 1}}",
            ]]);
        });

        test("blocks that don't match", async () => {
            const text = "[[start]]:\n{{#unless word}}a{{else if x}}b{{/if}}";
            expect(await templateErrors(text)).toEqual([[
                "error", "{{#unless word}}", "In section 'start', {{#unless word}} is closed by {{/if}}, but it needs a {{/unless}}",
            ]]);
        });

        test("a block that isn't closed, in a passage", async () => {
            const text = "[[start]]:\n[Look](look)\n\n[look]:\nYou see:\n{{#each items}}\n{{this}}\n{{#if lit}}It's lit.";
            expect(await templateErrors(text)).toEqual([[
                "error", "{{#if lit}}", "In section 'start', passage 'look', {{#if lit}} has no {{/if}} to close it",
            ]]);
        });

        test("an expression that can't be read", async () => {
            const text = "[[start]]:\nHi.\n{{#if score >}}Yes{{/if}}";
            expect(await templateErrors(text)).toEqual([[
                "error", "{{#if score >}}",
                "In section 'start', {{#if score >}} isn't valid: Invalid condition \"score >\": expected a value after '>'",
            ]]);
        });

        test("are found after links and expressions that are rewritten", async () => {
            const text = "[[start]]:\n[[Go]](next) {{= a * 2}} {{#if a > 1 and b}}[[Back]](start){{/if}} {{a/this}}\n\n[[next]]:\nN";
            expect(await templateErrors(text)).toEqual([[
                "error", "{{a/this}}", "In section 'start', {{a/this}} isn't valid Handlebars: Invalid path: a/this",
            ]]);
        });

        test("stop the story being built", async () => {
            const { compile } = await import("./compiler.js");
            const result = await compile({ script: "[[start]]:\n{{round + 1}}" });
            expect(result.success).toBe(false);
        });

        test("aren't reported for valid text", async () => {
            const text = "[[start]]:\n{{#if a}}x{{else if b}}y{{else}}z{{/if}} \\{{not + a tag}} {{{raw}}} {{#every 1000}}{{= n + 1}}{{/every}}";
            expect(await templateErrors(text)).toEqual([]);
        });
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

    test("the master section (#696)", async () => {
        const text = "[[]]:\nEvery section.\n\n[[a]]:\nA";
        const ls = createLanguageService({ files: memoryFiles({ "s.squiffy": text }), mainFile: "s.squiffy" });
        expect((await ls.getDocumentSymbols("s.squiffy")).map(s => [s.name, s.detail])).toEqual([
            ["", "Master section"],
            ["a", undefined],
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

    test("a passage, including {{deactivate}}", async () => {
        const text = "[[a]]:\nSee [b].\n\n[b]:\n@repeat\n{{#if done}}{{deactivate \"b\"}}{{/if}}";
        const files = memoryFiles({ "s.squiffy": text });
        const ls = createLanguageService({ files, mainFile: "s.squiffy" });
        const result = await ls.getRenameEdits("s.squiffy", positionOf(text, "[b]:", 1), "c");
        if (!result || "error" in result) throw new Error("Expected edits");
        expect(apply(text, result.edit["s.squiffy"])).toBe("[[a]]:\nSee [c].\n\n[c]:\n@repeat\n{{#if done}}{{deactivate \"c\"}}{{/if}}");
    });

    test("a section or passage, including seen, visits and lastvisited", async () => {
        const text = [
            "[[the bar]]:", "Drinks. [chat]", "", "[chat]:", "Hi.", "",
            "[[street]]:", "{{#if seen \"the bar\"}}Back again.{{/if}} {{#if (visits 'the bar') > 1}}Again!{{/if}}",
            "{{#unless (seen \"the bar\")}}New here.{{/unless}} {{lastvisited \"the bar\"}} {{visits \"chat\"}}",
            "You have seen \"the bar\" before, says the text.", "[[the bar]]",
        ].join("\n");
        const ls = createLanguageService({ files: memoryFiles({ "s.squiffy": text }), mainFile: "s.squiffy" });

        // Every literal name given to them inside {{...}} is a reference, but not text outside one
        const references = await ls.getReferences("s.squiffy", positionOf(text, "[[the bar]]:", 3), false);
        expect(references.map(r => slice(text, r.range))).toEqual([
            "[[the bar]]", "seen \"the bar\"", "visits 'the bar'", "seen \"the bar\"", "lastvisited \"the bar\"",
        ]);
        // And F12 from one goes to the section
        const definition = await ls.getDefinition("s.squiffy", positionOf(text, "(visits 'the bar')", 10));
        expect(definition?.range.start.line).toBe(0);

        const result = await ls.getRenameEdits("s.squiffy", positionOf(text, "[[the bar]]:", 3), "the pub");
        if (!result || "error" in result) throw new Error("Expected edits");
        const renamed = apply(text, result.edit["s.squiffy"]);
        expect(renamed).toContain("{{#if seen \"the pub\"}}");
        expect(renamed).toContain("{{#if (visits 'the pub') > 1}}");
        expect(renamed).toContain("{{#unless (seen \"the pub\")}}");
        expect(renamed).toContain("{{lastvisited \"the pub\"}}");
        expect(renamed).toContain("You have seen \"the bar\" before");
        expect(renamed).toContain("{{visits \"chat\"}}");

        // A passage, from another section, as they go by name alone
        const passage = await ls.getRenameEdits("s.squiffy", positionOf(text, "[chat]:", 1), "talk");
        if (!passage || "error" in passage) throw new Error("Expected edits");
        expect(apply(text, passage.edit["s.squiffy"])).toContain("{{visits \"talk\"}}");
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

    test("the name to rename, from a link or a header", async () => {
        const { ls } = project();
        const at = positionOf(cellar, "[[Go back up]](start)", 3);
        const fromLink = await ls.getRenameTarget("chapters/cellar.squiffy", at);
        expect(fromLink?.name).toBe("start");
        const start = positionOf(cellar, "[[Go back up]](start)", "[[Go back up]](".length);
        expect(fromLink?.range).toEqual({ start, end: { line: start.line, character: start.character + 5 } });
        const fromHeader = await ls.getRenameTarget("story.squiffy", positionOf(main, "[[outside]]:", 3));
        expect(fromHeader?.name).toBe("outside");
        expect(await ls.getRenameTarget("story.squiffy", { line: 0, character: 0 })).toBeUndefined();
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

    test("not the names the story gives the start, the master section or +++ sections (#696)", async () => {
        const files = memoryFiles({ "s.squiffy": "Intro [[\n+++Next\n[[]]:\n[[a]]:\nA" });
        const ls = createLanguageService({ files, mainFile: "s.squiffy" });
        const items = await ls.getCompletions("s.squiffy", { line: 0, character: 8 });
        expect(items.map(i => i.label)).toEqual(["a"]);
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

    test("section and passage names for seen and visits", async () => {
        expect((await complete("{{seen \"", "")).map(i => i.label)).toEqual(["cellar", "start", "outside"]);
        expect((await complete("{{#if (visits '", "")).map(i => i.label)).toEqual(["cellar", "start", "outside"]);
        const files = memoryFiles({ "s.squiffy": "[[a]]:\n{{#if (seen \"\n[p1]:\n[@last]:" });
        const ls = createLanguageService({ files, mainFile: "s.squiffy" });
        const items = await ls.getCompletions("s.squiffy", { line: 1, character: 13 });
        expect(items.map(i => i.label)).toEqual(["p1", "a"]);
    });

    test("section names for passages, and section and passage names for tags (#527)", async () => {
        expect((await complete("{{#each (passages \"", "")).map(i => i.label)).toEqual(["cellar", "start", "outside"]);
        const files = memoryFiles({ "s.squiffy": "[[a]]:\n{{tags \"\n[p1]:\n[@last]:" });
        const ls = createLanguageService({ files, mainFile: "s.squiffy" });
        const items = await ls.getCompletions("s.squiffy", { line: 1, character: 8 });
        expect(items.map(i => i.label)).toEqual(["p1", "a"]);
    });

    test("passage names for deactivate", async () => {
        const files = memoryFiles({ "s.squiffy": "[[a]]:\n{{deactivate \"\n[p1]:\n[@last]:" });
        const ls = createLanguageService({ files, mainFile: "s.squiffy" });
        const items = await ls.getCompletions("s.squiffy", { line: 1, character: 14 });
        expect(items.map(i => i.label)).toEqual(["p1"]);
    });

    test("attribute names", async () => {
        const files = memoryFiles({ "s.squiffy": "[[a]]:\n@set score=1\n    squiffy.set(\"gold\", 2);\n[[b]](a, not seen)\n@inc " });
        const ls = createLanguageService({ files, mainFile: "s.squiffy" });
        const items = await ls.getCompletions("s.squiffy", { line: 4, character: 5 });
        expect(items.map(i => i.label)).toEqual(["gold", "score", "seen"]);
    });

    test("attribute names with values inside objects (#442)", async () => {
        const files = memoryFiles({ "s.squiffy": "[[a]]:\n@set hero = { hp: 10, name: \"Ann\" }\n@set hero.stats.str += 1\n[[b]](a, bag = { gold: 1, gems: 2 }, bag.full)\n@set " });
        const ls = createLanguageService({ files, mainFile: "s.squiffy" });
        const items = await ls.getCompletions("s.squiffy", { line: 4, character: 5 });
        expect(items.map(i => i.label)).toEqual(["bag", "bag.full", "hero", "hero.stats", "hero.stats.str"]);
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
        expect(items[0]).toMatchObject({ label: "description", kind: "snippet", insertText: "A damp cellar." });
        // and the built-in snippets, by their prefixes
        expect(items.find(i => i.label == "ifelse")).toMatchObject({
            kind: "snippet", detail: "If… otherwise…", isSnippet: true, insertText: "{{#if ${1:condition}}}\n$2\n{{else}}\n$0\n{{/if}}",
        });
    });

    describe("helpers", () => {
        // The text of the cursor's line, with the item applied
        const applied = async (line: string, cursor: number, label: string) => {
            const files = memoryFiles({ "s.squiffy": `[[a]]:\n@set score = 1\n${line}` });
            const ls = createLanguageService({ files, mainFile: "s.squiffy" });
            const items = await ls.getCompletions("s.squiffy", { line: 2, character: cursor });
            const item = items.find(i => i.label == label);
            if (!item) return { items, text: undefined };
            expect(item.range.start.line).toBe(2);
            const text = line.substring(0, item.range.start.character) + (item.insertText ?? item.label) + line.substring(item.range.end.character);
            return { items, item, text };
        };

        test("block helpers after {{#, replacing the }} an editor closed {{ with", async () => {
            const { items, text } = await applied("{{#i}}", 4, "if");
            expect(items.map(i => i.label)).toEqual(["animate", "each", "embed", "every", "firsttime", "if", "label", "once", "replace", "style", "unless", "with"]);
            expect(text).toBe("{{#if ${1:condition}}}\n$0\n{{/if}}");
        });

        test("a block in a line of text stays on the line", async () => {
            expect((await applied("You {{#if", 9, "if")).text).toBe("You {{#if ${1:condition}}}$0{{/if}}");
            expect((await applied("{{#once", 7, "once")).text).toBe("{{#once}}\n$0\n{{/once}}");
        });

        test("only the name, in a call that's already written", async () => {
            const { item, text } = await applied("{{#i x}}", 4, "if");
            expect(item!.isSnippet).toBeFalsy();
            expect(text).toBe("{{#if x}}");
            expect((await applied("{{sec \"a\"}}", 5, "section")).text).toBe("{{section \"a\"}}");
        });

        test("helpers and attributes after {{", async () => {
            const { items, text } = await applied("{{sec}}", 5, "section");
            expect(text).toBe("{{section \"${1:name}\" text=\"${2:label}\"}}");
            expect(items.find(i => i.label == "score")).toMatchObject({ kind: "attribute", insertText: "score}}" });
            expect(items.find(i => i.label == "else")).toMatchObject({ kind: "keyword" });
            // A block helper is offered with its #
            const block = items.find(i => i.label == "#if")!;
            expect(block.filterText).toBe("if");
            expect((await applied("{{i", 3, "#if")).text).toBe("{{#if ${1:condition}}}\n$0\n{{/if}}");
            expect((await applied("{{cl", 4, "clear")).text).toBe("{{clear}}");
        });

        test("in a subexpression inside {{ }}", async () => {
            const { items, text } = await applied("{{#if (se)}}", 9, "seen");
            expect(text).toBe("{{#if (seen \"${1:name}\")}}");
            expect(items.some(i => i.label.startsWith("#"))).toBe(false);
            expect(items.some(i => i.label == "else")).toBe(false);
            expect((await applied("{{#if (seen \"a\") and (", 23, "not")).text).toBe("{{#if (seen \"a\") and (not ${1:value})");
        });

        test("not ( in text, a link or a comment", async () => {
            const files = memoryFiles({ "s.squiffy": "[[a]]:\nSome (aside\n[[a]](a\n{{!-- (x" });
            const ls = createLanguageService({ files, mainFile: "s.squiffy" });
            expect(await ls.getCompletions("s.squiffy", { line: 1, character: 11 })).toEqual([]);
            expect((await ls.getCompletions("s.squiffy", { line: 2, character: 7 })).map(i => i.kind)).not.toContain("helper");
            expect(await ls.getCompletions("s.squiffy", { line: 3, character: 8 })).toEqual([]);
        });

        test("the innermost open block after {{/", async () => {
            const files = memoryFiles({ "s.squiffy": "[[a]]:\n{{#if x}}\n{{#each y}}{{/each}}\n{{#once}}\n{{/once}}\n{{/}}" });
            const ls = createLanguageService({ files, mainFile: "s.squiffy" });
            const items = await ls.getCompletions("s.squiffy", { line: 5, character: 3 });
            expect(items).toMatchObject([{ label: "if", insertText: "if}}", range: { start: { character: 3 }, end: { character: 5 } } }]);
        });
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
        // After the section the link's in, where the story map would put it (#680)
        expect(apply(cellar, actions[0].edit["chapters/cellar.squiffy"])).toBe(cellar.replace("\n[snippet:", "\n[[missing room]]:\n\n[snippet:"));
        // So an editor can offer it at the cursor, and put the section where it chooses (#677)
        expect(actions[0]).toMatchObject({ isPreferred: true, create: { kind: "section", name: "missing room" } });
    });

    test("a missing section linked with a setter: the warning and the fix name the same section (#705)", async () => {
        const text = "[[a]]:\n[[Shop]](Shop, score+=5)";
        const ls = createLanguageService({ files: memoryFiles({ "s.squiffy": text }), mainFile: "s.squiffy" });
        const diagnostic = (await ls.getDiagnostics("s.squiffy")).find(d => d.code == "squiffy/unknown-section-link")!;
        expect(diagnostic.message).toBe("In section 'a' there is a link to a section called [[Shop]], which doesn't exist");
        const actions = await ls.getCodeActions("s.squiffy", diagnostic.range);
        expect(actions.map(a => a.title)).toEqual(["Create section 'Shop'"]);
    });

    test("a link in Twine's style says what to write instead, and changes it (#711)", async () => {
        const text = "[[a]]:\n[[Go inside->Mill floor]] [[Mill floor<-Enter]] [[Leave|Road]] [[Road->Road]]\n\n[[Mill floor]]:\nDusty.";
        const ls = createLanguageService({ files: memoryFiles({ "s.squiffy": text }), mainFile: "s.squiffy" });
        const diagnostics = (await ls.getDiagnostics("s.squiffy")).filter(d => d.code != "squiffy/unreachable-section");
        expect(diagnostics.map(d => [d.code, slice(text, d.range)])).toEqual([
            ["squiffy/twine-syntax", "[[Go inside->Mill floor]]"],
            ["squiffy/twine-syntax", "[[Mill floor<-Enter]]"],
            ["squiffy/twine-syntax", "[[Leave|Road]]"],
            ["squiffy/twine-syntax", "[[Road->Road]]"],
        ]);
        expect(diagnostics[0].message).toBe("In section 'a' there is a link in Twine's style, [[Go inside->Mill floor]]. In Squiffy, write [[Go inside]](Mill floor)");
        const fixes = await Promise.all(diagnostics.map(d => ls.getCodeActions("s.squiffy", d.range)));
        expect(fixes.map(actions => actions.map(a => a.title))).toEqual([
            ["Change to [[Go inside]](Mill floor)"],
            ["Change to [[Enter]](Mill floor)"],
            ["Change to [[Leave]](Road)"],
            ["Change to [[Road]]"],
        ]);
        expect(apply(text, fixes[0][0].edit["s.squiffy"])).toBe(text.replace("[[Go inside->Mill floor]]", "[[Go inside]](Mill floor)"));
    });

    test("a section whose name has Twine's link syntax in it is still linked to", async () => {
        const text = "[[a]]:\n[[Left|Right]]\n\n[[Left|Right]]:\nHere.\n@end";
        const ls = createLanguageService({ files: memoryFiles({ "s.squiffy": text }), mainFile: "s.squiffy" });
        expect((await ls.getDiagnostics("s.squiffy")).map(d => d.code)).toEqual([]);
    });

    test("a Harlowe hook says it's Twine code (#711)", async () => {
        const text = "[[a]]:\n(if: $key)[You unlock it.](else:)[It's locked.]";
        const ls = createLanguageService({ files: memoryFiles({ "s.squiffy": text }), mainFile: "s.squiffy" });
        const diagnostics = (await ls.getDiagnostics("s.squiffy")).filter(d => d.code.startsWith("squiffy/twine") || d.code.includes("link"));
        expect(diagnostics.map(d => [d.code, slice(text, d.range)])).toEqual([
            ["squiffy/twine-syntax", "(if: $key)[You unlock it.]"],
            ["squiffy/twine-syntax", "(else:)[It's locked.]"],
        ]);
        expect(diagnostics[1].message).toBe("In section 'a' there is Twine code, (else:)[...], which Squiffy doesn't run. Use {{#if}}...{{else}}...{{/if}} for text that depends on an attribute");
        expect(await ls.getCodeActions("s.squiffy", diagnostics[1].range)).toEqual([]);
    });

    test("a missing section goes after the link's section, and the sections it leads to", async () => {
        const text = "[[a]]:\n[[b]] or [[c]].\n\n[[b]]:\nB\n\n[[d]]:\nD";
        const ls = createLanguageService({ files: memoryFiles({ "s.squiffy": text }), mainFile: "s.squiffy" });
        const diagnostic = (await ls.getDiagnostics("s.squiffy")).find(d => d.code == "squiffy/unknown-section-link")!;
        const actions = await ls.getCodeActions("s.squiffy", diagnostic.range);
        expect(apply(text, actions[0].edit["s.squiffy"])).toBe("[[a]]:\n[[b]] or [[c]].\n\n[[b]]:\nB\n\n[[c]]:\n\n[[d]]:\nD");
    });

    test("a missing section linked from the master section goes at the end", async () => {
        const text = "[[]]:\nSee [[x]].\n\n[[a]]:\nA";
        const ls = createLanguageService({ files: memoryFiles({ "s.squiffy": text }), mainFile: "s.squiffy" });
        const diagnostic = (await ls.getDiagnostics("s.squiffy")).find(d => d.code == "squiffy/unknown-section-link")!;
        const actions = await ls.getCodeActions("s.squiffy", diagnostic.range);
        expect(apply(text, actions[0].edit["s.squiffy"])).toBe(text + "\n\n[[x]]:\n");
    });

    test("create a missing passage", async () => {
        const text = "[[a]]:\nSee [p].\n\n[[b]]:\nB";
        const ls = createLanguageService({ files: memoryFiles({ "s.squiffy": text }), mainFile: "s.squiffy" });
        const diagnostic = (await ls.getDiagnostics("s.squiffy"))[0];
        const actions = await ls.getCodeActions("s.squiffy", diagnostic.range);
        expect(actions[0].title).toBe("Create passage 'p'");
        expect(actions[0]).toMatchObject({ isPreferred: true, create: { kind: "passage", name: "p" } });
        expect(apply(text, actions[0].edit["s.squiffy"])).toBe("[[a]]:\nSee [p].\n[p]:\n\n[[b]]:\nB");
    });

    test("@name in setters, in a story with a squiffy.json (#373)", async () => {
        const text = "[[a]]:\n@set best = @score + 1\n@set quote = \"@not this\"\n[[Go]](b, gold -= @price)\n\n[[b]]:\nB";
        const files = { "squiffy.json": "{ \"version\": 1, \"main\": \"s.squiffy\" }", "s.squiffy": text };
        const ls = createLanguageService({ files: memoryFiles(files), mainFile: "s.squiffy" });
        const diagnostics = (await ls.getDiagnostics("s.squiffy")).filter(d => d.code == "squiffy/at-attribute");
        expect(diagnostics.map(d => slice(text, d.range))).toEqual(["@score", "@price"]);
        expect(diagnostics[0].message).toBe("Use score rather than @score: in a story with a squiffy.json, setters name attributes without \"@\".");
        const actions = await ls.getCodeActions("s.squiffy", diagnostics[1].range);
        expect(actions.map(a => a.title)).toEqual(["Change to price"]);
        expect(apply(text, actions[0].edit["s.squiffy"])).toContain("[[Go]](b, gold -= price)");
    });

    test("text without quotes in setters, in a story with a squiffy.json (#373)", async () => {
        const text = [
            "[[a]]:",
            "@set weapon = sword",
            "@set greeting = Hello there",
            "@set best = score",
            "@set name_copy = player",
            "@set count += many",
            "@set rich = gold > 100",
            "@set ok = \"fine\"",
            "[[Go]](b, mood = happy, item = shield, title = The End)",
            "{{section \"b\" text=\"B\" set=\"colour = red\"}}",
            "<input data-attribute=\"player\">",
            "{{set \"score\" 10}}",
            "",
            "[[b]]:",
            "    squiffy.set(\"shield\", true);",
            "B",
        ].join("\n");
        const files = { "squiffy.json": "{ \"version\": 1, \"main\": \"s.squiffy\" }", "s.squiffy": text };
        const ls = createLanguageService({ files: memoryFiles(files), mainFile: "s.squiffy" });
        const diagnostics = (await ls.getDiagnostics("s.squiffy")).filter(d => d.code == "squiffy/unquoted-text")
            .sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);
        // score, player and shield are set somewhere, so they're attributes. count += many is
        // an error whatever it means.
        expect(diagnostics.map(d => slice(text, d.range))).toEqual(["sword", "Hello there", "happy", "The End", "red"]);
        expect(diagnostics[0].message).toBe("sword isn't set anywhere in the story, so this sets weapon to nothing. For the text \"sword\", use quotes.");
        expect(diagnostics[1].message).toBe("Text in a setter goes in quotes in a story with a squiffy.json: \"Hello there\".");

        const fix = async (i: number) => {
            const [action] = await ls.getCodeActions("s.squiffy", diagnostics[i].range);
            return [action.title, apply(text, action.edit["s.squiffy"]).split("\n")[diagnostics[i].range.start.line]];
        };
        expect(await fix(0)).toEqual(["Change to \"sword\"", "@set weapon = \"sword\""]);
        expect(await fix(2)).toEqual(["Change to \"happy\"", "[[Go]](b, mood = \"happy\", item = shield, title = The End)"]);
        // Inside set="...", single quotes save escaping
        expect(await fix(4)).toEqual(["Change to 'red'", "{{section \"b\" text=\"B\" set=\"colour = 'red'\"}}"]);
    });

    test("text without quotes inside an object (#442)", async () => {
        const text = [
            "[[a]]:",
            "@set hero.name = Ann",
            "@set hero = { name: \"Bea\", hp: 10 }",
            "@set list = [1, 2]",
            "[[Go]](a, bag = { gold: 1, gems: 2 }, bag.colour = red)",
        ].join("\n");
        const files = { "squiffy.json": "{ \"version\": 1, \"main\": \"s.squiffy\" }", "s.squiffy": text };
        const ls = createLanguageService({ files: memoryFiles(files), mainFile: "s.squiffy" });
        const diagnostics = (await ls.getDiagnostics("s.squiffy")).filter(d => d.code == "squiffy/unquoted-text");
        expect(diagnostics.map(d => slice(text, d.range))).toEqual(["Ann", "red"]);
        expect(diagnostics[0].message).toBe("Ann isn't set anywhere in the story, so this sets hero.name to nothing. For the text \"Ann\", use quotes.");
    });

    test("no warning for text without quotes without a squiffy.json, where it's how setters set text", async () => {
        const text = "[[a]]:\n@set weapon = sword\n@set greeting = Hello there\n\nA";
        const ls = createLanguageService({ files: memoryFiles({ "s.squiffy": text }), mainFile: "s.squiffy" });
        expect((await ls.getDiagnostics("s.squiffy")).some(d => d.code == "squiffy/unquoted-text")).toBe(false);
    });

    test("no warning for @name without a squiffy.json, where it's how setters use attributes", async () => {
        const text = "[[a]]:\n@set best = @score\n\nA";
        const ls = createLanguageService({ files: memoryFiles({ "s.squiffy": text }), mainFile: "s.squiffy" });
        expect((await ls.getDiagnostics("s.squiffy")).some(d => d.code == "squiffy/at-attribute")).toBe(false);
    });

    test("warning for setting turns, which Squiffy counts itself", async () => {
        const text = [
            "[[]]:",
            "@inc turns",
            "    squiffy.set(\"turns\", 0);",
            "[[a]]:",
            "@set turns = 0",
            "@set score = turns + 1",
            "[[Go]](b, turns = 5)",
            "{{set \"turns\" 1}} {{inc 'turns'}} {{turns}} {{#if turns > 2}}Late{{/if}}",
            "[[b]]:",
            "B",
        ].join("\n");
        const ls = createLanguageService({ files: memoryFiles({ "s.squiffy": text }), mainFile: "s.squiffy" });
        const diagnostics = (await ls.getDiagnostics("s.squiffy")).filter(d => d.code == "squiffy/built-in-attribute");
        expect(diagnostics.map(d => [d.range.start.line, slice(text, d.range)])).toEqual([
            [1, "turns"], [2, "turns"], [4, "turns"], [6, "turns"], [7, "turns"], [7, "turns"],
        ]);
        expect(diagnostics[0].severity).toBe("warning");
        expect(diagnostics[0].message).toBe("Squiffy sets turns itself: it's the number of links clicked in the story so far. Use a different name for your own attribute.");
    });

    test("warning for setting previous and previous_section, which Squiffy sets itself", async () => {
        const text = [
            "[[a]]:",
            "@set previous = \"a\"",
            "[[Go]](b, previous_section = \"a\")",
            "{{#if previous = \"a\"}}Back{{/if}} {{previous_section}}",
            "[[b]]:",
            "B",
        ].join("\n");
        const ls = createLanguageService({ files: memoryFiles({ "s.squiffy": text }), mainFile: "s.squiffy" });
        const diagnostics = (await ls.getDiagnostics("s.squiffy")).filter(d => d.code == "squiffy/built-in-attribute");
        expect(diagnostics.map(d => [d.range.start.line, slice(text, d.range)])).toEqual([
            [1, "previous"], [2, "previous_section"],
        ]);
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

describe("preview story", () => {
    test("compiles the story with its stylesheets and scripts, using open files' text", async () => {
        const service = createLanguageService({
            mainFile: "story/main.squiffy",
            files: memoryFiles({
                "story/main.squiffy": "@import style/look.css\n@import code.js\nHello.",
                "story/style/look.css": "body { background: url(cat.png); }",
                "story/code.js": "console.log(1);",
            }),
        });
        service.updateFile("story/main.squiffy", "@import style/look.css\n@import code.js\n@import missing.js\nHello from the editor.");
        const story = await service.getPreviewStory();
        if (!story.success) throw new Error(story.errors.join());
        expect(story.js).toContain("Hello from the editor.");
        expect(story.js).toMatch(/^export const story/m);
        // The url() is made a path from the main file's folder
        expect(story.css).toEqual(["body { background: url(\"style/cat.png\"); }"]);
        expect(story.scripts).toEqual(["console.log(1);"]);
    });

    test("gives the story's errors", async () => {
        const service = createLanguageService({
            mainFile: "main.squiffy",
            files: memoryFiles({ "main.squiffy": "[[a]]:\n{{#if x}}\n" }),
        });
        const story = await service.getPreviewStory();
        expect(story.success).toBe(false);
        if (!story.success) expect(story.errors.length).toBeGreaterThan(0);
    });
});
