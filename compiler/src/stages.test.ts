import { beforeAll, describe, expect, test, vi } from "vitest";

import { analyse, compile, emit, formatDiagnostic, parse, ParseCache } from "./compiler.js";
import type { Range, SectionNode } from "./compiler.js";

beforeAll(() => {
    vi.stubGlobal("crypto", {
        randomUUID: () => "00000000-0000-0000-0000-000000000000"
    });
});

const range = (startLine: number, startChar: number, endLine: number, endChar: number): Range => ({
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
});

// Returns the text a range covers
const slice = (text: string, r: Range) => {
    const lines = text.split("\n");
    if (r.start.line == r.end.line) return lines[r.start.line].substring(r.start.character, r.end.character);
    return [
        lines[r.start.line].substring(r.start.character),
        ...lines.slice(r.start.line + 1, r.end.line),
        lines[r.end.line].substring(0, r.end.character),
    ].join("\n");
};

describe("parse", () => {
    const script = [
        "@title My story",          // 0
        "",                         // 1
        "[[start]]:",               // 2
        "@set seen",                // 3
        "    console.log(1);",      // 4
        "Go to [[the kitchen]](kitchen, hungry=1) or [look around].", // 5
        "",                         // 6
        "[look around]:",           // 7
        "{{embed \"desc\"}} [[Onward>]]", // 8
        "",                         // 9
        "[snippet: desc]:",         // 10
        "A room.",                  // 11
        "[not a passage]:",         // 12
        "",                         // 13
        "[[kitchen]]:",             // 14
        "@inc visits 2",            // 15
        "+++Next",                  // 16
        "---",                      // 17
        "The end.",                 // 18
    ].join("\n");
    const file = parse(script, "story.squiffy");

    test("file structure", () => {
        expect(file.filename).toBe("story.squiffy");
        expect(file.preamble.body.map(n => n.type)).toEqual(["title"]);
        expect(file.sections.map(s => s.type == "section" ? `${s.kind}:${s.name ?? ""}` : `snippet:${s.name}`)).toEqual([
            "named:start", "snippet:desc", "named:kitchen", "continue:", "separator:",
        ]);
    });

    test("sections, passages and statements have ranges", () => {
        const start = file.sections[0] as SectionNode;
        expect(start.nameRange).toEqual(range(2, 2, 2, 7));
        expect(start.range).toEqual(range(2, 0, 9, 0));
        expect(start.body.map(n => n.type)).toEqual(["attribute", "js", "text", "text"]);
        expect(start.body[1]).toMatchObject({ type: "js", code: "console.log(1);", codeRange: range(4, 4, 4, 19) });

        const passage = start.passages[0];
        expect(passage.name).toBe("look around");
        expect(passage.nameRange).toEqual(range(7, 1, 7, 12));
        expect(passage.range).toEqual(range(7, 0, 9, 0));

        const kitchen = file.sections[2] as SectionNode;
        expect(kitchen.body[0]).toMatchObject({ type: "attribute", directive: "inc", value: "visits", amount: "2", valueRange: range(15, 5, 15, 11) });
        expect(file.preamble.body[0]).toMatchObject({ type: "title", value: "My story", valueRange: range(0, 7, 0, 15) });
    });

    test("links and embeds", () => {
        const start = file.sections[0] as SectionNode;
        expect(start.links).toEqual([
            {
                type: "link", linkType: "section", form: "named", text: "the kitchen", target: "kitchen, hungry=1",
                range: range(5, 6, 5, 40), targetRange: range(5, 22, 5, 39),
            },
            {
                type: "link", linkType: "passage", form: "unnamed", target: "look around",
                range: range(5, 44, 5, 57), targetRange: range(5, 45, 5, 56),
            },
        ]);
        for (const link of start.links) {
            expect(slice(script, link.targetRange)).toBe(link.target);
        }

        const passage = start.passages[0];
        expect(passage.embeds).toEqual([{ type: "embed", name: "desc", range: range(8, 0, 8, 14), nameRange: range(8, 9, 8, 13) }]);
        expect(passage.links).toMatchObject([{ linkType: "section", form: "next", text: "Onward", range: range(8, 17, 8, 28) }]);
    });

    test("snippets are parsed, and passages inside them are just content", () => {
        const snippet = file.sections[1];
        expect(snippet).toMatchObject({
            type: "snippet", name: "desc", nameRange: range(10, 10, 10, 14), content: "A room.\n[not a passage]:\n",
            range: range(10, 0, 13, 0),
        });
    });

    test("continue and separator lines start sections", () => {
        const [, , , cont, sep] = file.sections as SectionNode[];
        expect(cont.header).toEqual({ type: "continue", text: "Next", range: range(16, 0, 16, 7) });
        expect(sep.header).toEqual({ type: "separator", range: range(17, 0, 17, 3) });
        expect(sep.body).toMatchObject([{ type: "text", text: "The end." }]);
    });

    test("links that span lines, and links next to Handlebars", () => {
        const text = "[[a]]:\nSee [[the\nkitchen]](kitchen). {{x.[1]}} [[{{name}}'s room]](room)";
        const links = (parse(text).sections[0] as SectionNode).links;
        expect(links.map(l => [l.target, l.range])).toEqual([
            ["kitchen", range(1, 4, 2, 18)],
            ["room", range(2, 30, 2, 55)],
        ]);
        expect(links[1].text).toBe("{{name}}'s room");
    });
});

describe("analyse", () => {
    test("{{goto}} to a section that doesn't exist", async () => {
        const script = "[[start]]:\n{{goto \"nowhere\"}} {{goto \"start\"}} {{goto (get \"x\")}}\n\n[p]:\n{{goto 'p'}}";
        const analysis = await analyse({ script, scriptBaseFilename: "story.squiffy" });
        expect(analysis.diagnostics.map(d => [d.code, slice(script, d.range), d.message])).toEqual([
            ["squiffy/unknown-goto", "{{goto \"nowhere\"", "In section 'start' there is a {{goto \"nowhere\"}}, but no section with that name exists"],
            ["squiffy/unknown-goto", "{{goto 'p'", "In section 'start', passage 'p' there is a {{goto \"p\"}}, but no section with that name exists ({{goto}} can't go to a passage: use {{embed \"p\"}} to show it here)"],
        ]);
    });

    test("@start naming a section that doesn't exist is an error", async () => {
        const script = "@title Lost\n@start nowhere\n\nHello [[a]].\n\n[[a]]:\n@end\nDone.";
        const analysis = await analyse({ script, scriptBaseFilename: "story.squiffy" });
        expect(analysis.success).toBe(false);
        expect(analysis.diagnostics.map(d => [d.severity, d.code, slice(script, d.range), d.message])).toEqual([
            ["error", "squiffy/unknown-start", "nowhere",
                "@start names a section called [[nowhere]], which doesn't exist, so the story has nowhere to start."],
        ]);

        // One that exists is fine
        const fine = await analyse({ script: script.replace("@start nowhere", "@start a"), scriptBaseFilename: "story.squiffy" });
        expect(fine.success).toBe(true);
        expect(fine.diagnostics.filter(d => d.code == "squiffy/unknown-start")).toEqual([]);
    });

    test("{{deactivate}} of a passage that isn't in the section (#13)", async () => {
        const script = "[[start]]:\nSee [a] or [b].\n\n[a]:\n{{deactivate \"b\"}} {{deactivate \"nowhere\"}} {{deactivate}}\n\n[b]:\nB.\n\n[[]]:\n\n[m]:\n{{deactivate 'm'}}";
        const analysis = await analyse({ script, scriptBaseFilename: "story.squiffy" });
        expect(analysis.diagnostics.map(d => [d.code, slice(script, d.range), d.message])).toEqual([
            ["squiffy/unknown-deactivate", "{{deactivate \"nowhere\"", "In section 'start', passage 'a' there is a {{deactivate \"nowhere\"}}, but no passage with that name exists in this section"],
        ]);
    });

    test("link diagnostics point at the link", async () => {
        const script = "[[start]]:\nSome text.\nGo [[nowhere]] or [[nope]](missing, x=1).\n\n[p]:\nTry [q] and {{embed \"zzz\"}} {{#embed \"yyy\" a=1}}x{{/embed}}.";
        const analysis = await analyse({ script, scriptBaseFilename: "story.squiffy" });

        expect(analysis.success).toBe(true);
        expect(analysis.diagnostics.map(d => [d.code, slice(script, d.range)])).toEqual([
            ["squiffy/unknown-section-link", "[[nope]](missing, x=1)"],
            ["squiffy/unknown-section-link", "[[nowhere]]"],
            ["squiffy/unknown-passage-link", "[q]"],
            ["squiffy/unknown-embed", "{{embed \"zzz\""],
            ["squiffy/unknown-embed", "{{#embed \"yyy\""],
        ]);
        expect(analysis.diagnostics[0]).toEqual({
            file: "story.squiffy",
            range: range(2, 18, 2, 40),
            severity: "warning",
            code: "squiffy/unknown-section-link",
            message: "In section 'start' there is a link to a section called [[missing, x=1]], which doesn't exist",
        });
        expect(formatDiagnostic(analysis.diagnostics[0])).toBe(
            "WARNING: story.squiffy line 3: In section 'start' there is a link to a section called [[missing, x=1]], which doesn't exist");
    });

    test("next-section link with no next section", async () => {
        const script = "[[only]]:\n\nThe end [[Onward>]]";
        const analysis = await analyse({ script, scriptBaseFilename: "s.squiffy" });
        expect(analysis.diagnostics.map(d => [d.code, slice(script, d.range)])).toEqual([
            ["squiffy/no-next-section", "[[Onward>]]"],
            ["squiffy/unknown-section-link", "[[Onward>]]"],
        ]);
    });

    test("errors", async () => {
        let analysis = await analyse({ script: "\n[orphan]:\ntext", scriptBaseFilename: "s.squiffy" });
        expect(analysis.success).toBe(false);
        expect(analysis.diagnostics).toEqual([{
            file: "s.squiffy", range: range(1, 1, 1, 7), severity: "error", code: "squiffy/passage-without-section",
            message: "Can't add passage \"orphan\" as no section has been created.",
        }]);

        analysis = await analyse({ script: "@ui\nhello", scriptBaseFilename: "s.squiffy" });
        expect(analysis.diagnostics.map(d => [d.code, d.range])).toEqual([["squiffy/text-in-ui-block", range(1, 0, 1, 5)]]);
    });

    test("content before the first section of an imported file is an error, not a crash", async () => {
        const analysis = await analyse({
            script: "[[a]]:\n@import b.squiffy",
            scriptBaseFilename: "a.squiffy",
            externalFiles: {
                getMatchingFilenames: async () => ["b.squiffy"],
                getContent: async () => "Ignored text\n@set x\n[[b]]:\n",
                getLocalFilename: f => f,
            },
        });
        expect(analysis.success).toBe(false);
        expect(analysis.files.map(f => f.filename)).toEqual(["a.squiffy", "b.squiffy"]);
        expect(analysis.diagnostics).toMatchObject([{ file: "b.squiffy", code: "squiffy/content-before-section", range: range(1, 0, 1, 6) }]);
    });

    test("v5 syntax and missing external files", async () => {
        const script = "@import x.squiffy\n[[a]]:\nHello {name}.";
        const analysis = await analyse({ script, scriptBaseFilename: "s.squiffy" });
        expect(analysis.diagnostics.map(d => [d.code, slice(script, d.range)])).toEqual([
            ["squiffy/v5-syntax", "{name}"],
            ["squiffy/external-files-unavailable", "@import x.squiffy"],
        ]);
    });

    test("symbols", async () => {
        const script = "Intro\n[intro passage]:\n\n[[a]]:\n[p]:\n+++\n[[a]]:\n[q]:";
        const analysis = await analyse({ script, scriptBaseFilename: "s.squiffy" });
        expect(analysis.sections.map(s => [s.name, s.node?.kind, s.passages.map(p => p.name)])).toEqual([
            ["_default", "preamble", ["intro passage"]],
            // The second [[a]] replaces the first, but keeps its place
            ["a", "named", ["q"]],
            ["_continue1", "continue", []],
        ]);
        expect(analysis.sections[0].node).toBe(analysis.files[0].preamble);
    });

    test("parse cache reuses unchanged files", async () => {
        const cache = new ParseCache();
        const files: Record<string, string> = { "b.squiffy": "[[b]]:\nb" };
        const settings = (script: string) => ({
            script,
            scriptBaseFilename: "a.squiffy",
            parseCache: cache,
            externalFiles: {
                getMatchingFilenames: async () => ["b.squiffy"],
                getContent: async (f: string) => files[f],
                getLocalFilename: (f: string) => f,
            },
        });
        const first = await analyse(settings("[[a]]:\n@import b.squiffy"));
        const second = await analyse(settings("[[a]]:\nchanged\n@import b.squiffy"));
        expect(second.files[0]).not.toBe(first.files[0]);
        expect(second.files[1]).toBe(first.files[1]);
    });
});

describe("emit", () => {
    test("emits the same as compile()", async () => {
        const script = "[[a]]:\nHello [[b]]\n[[b]]:\n    js();\nBye";
        const analysis = await analyse({ script });
        const emitted = emit(analysis, { globalJs: true });
        const compiled = await compile({ script, globalJs: true });
        expect(compiled.success).toBe(true);
        if (!compiled.success) return;
        expect(emitted.output).toEqual(compiled.output);
        expect(await emitted.getJs()).toBe(await compiled.getJs());
    });

    test("refuses an analysis with errors", async () => {
        const analysis = await analyse({ script: "[p]:" });
        expect(() => emit(analysis)).toThrow();
    });
});

describe("compile", () => {
    test("returns diagnostics alongside errors and onWarning", async () => {
        const warnings: string[] = [];
        const result = await compile({
            script: "[[a]]:\n\n\nGo [[b]]",
            scriptBaseFilename: "s.squiffy",
            onWarning: w => warnings.push(w),
        });
        // onWarning keeps giving the section's line; the diagnostic gives the link's
        expect(warnings).toEqual(["WARNING: s.squiffy line 1: In section 'a' there is a link to a section called [[b]], which doesn't exist"]);
        expect(result.diagnostics.map(formatDiagnostic)).toEqual(["WARNING: s.squiffy line 4: In section 'a' there is a link to a section called [[b]], which doesn't exist"]);

        const failed = await compile({ script: "[p]:", scriptBaseFilename: "s.squiffy" });
        expect(failed.success).toBe(false);
        if (failed.success) return;
        expect(failed.errors).toEqual(["ERROR: s.squiffy line 1: Can't add passage \"p\" as no section has been created."]);
        expect(failed.diagnostics.map(formatDiagnostic)).toEqual(failed.errors);
    });
});
