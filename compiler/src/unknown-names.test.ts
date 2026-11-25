// {{name}} that's neither a helper nor an attribute the story sets (#526), and the
// {{!-- squiffy-ignore --}} comments that turn warnings off
import { beforeAll, describe, expect, test, vi } from "vitest";
import { compile } from "./compiler.js";
import { createLanguageService, ProjectFiles, WorkspaceEdit } from "./language-service.js";
import { findTemplateNames } from "./templates.js";
import type { Position } from "./syntax.js";

beforeAll(() => {
    vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-0000-0000-000000000000" });
});

function memoryFiles(files: Record<string, string>): ProjectFiles {
    return {
        list: async () => Object.keys(files).map(path => ({ path })),
        readText: async (path: string) => {
            if (!(path in files)) throw new Error(`No file ${path}`);
            return files[path];
        },
    };
}

const service = (files: Record<string, string>, mainFile = "s.squiffy") => createLanguageService({ files: memoryFiles(files), mainFile });

async function unknownNames(files: Record<string, string>, mainFile = "s.squiffy") {
    return (await service(files, mainFile).getAllDiagnostics()).filter(d => d.code == "squiffy/unknown-name").map(d => d.subject);
}

function apply(text: string, edits: WorkspaceEdit[string]) {
    const lines = text.split("\n");
    const offset = (p: Position) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
    for (const edit of [...edits].sort((a, b) => offset(b.range.start) - offset(a.range.start))) {
        text = text.substring(0, offset(edit.range.start)) + edit.newText + text.substring(offset(edit.range.end));
    }
    return text;
}

describe("findTemplateNames", () => {
    test("finds {{name}} on its own, and where it is", () => {
        const text = "A {{gold}} {{hero.hp}} {{{raw}}} {{= gold + 1}} {{#if x}}{{y}}{{/if}} {{seen \"a\"}} {{this.z}} {{@index}}";
        const names = findTemplateNames(text);
        expect(names.bare.map(b => [b.name, b.root, text.slice(b.start, b.end)])).toEqual([
            ["gold", "gold", "{{gold}}"],
            ["hero.hp", "hero", "{{hero.hp}}"],
            ["raw", "raw", "{{{raw}}}"],
            ["y", "y", "{{y}}"],
        ]);
    });

    test("leaves out names in blocks that change what names refer to", () => {
        const names = findTemplateNames("{{#each list}}{{name}}{{/each}} {{#join list as |item|}}{{item}}{{/join}} {{#with hero}}{{hp}}{{/with}}");
        expect(names.bare).toEqual([]);
    });

    test("finds the values passed to embeds", () => {
        expect([...findTemplateNames("{{embed \"say\" who=\"Ann\" line=(array 1)}} {{#embed \"box\" title=\"T\"}}x{{/embed}}").embedParameters])
            .toEqual(["who", "line", "title"]);
    });

    test("finds nothing in text that isn't valid", () => {
        expect(findTemplateNames("{{#if x}}{{y}}").bare).toEqual([]);
    });
});

describe("the unknown-name warning", () => {
    test("for a name that's neither a helper nor an attribute the story sets", async () => {
        const text = "[[a]]:\n@set gold = 1\nYou have {{glod}} gold, and {{board}}.\n@end";
        const diagnostics = (await service({ "s.squiffy": text }).getAllDiagnostics()).filter(d => d.code == "squiffy/unknown-name");
        expect(diagnostics.map(d => d.message)).toEqual([
            "In section 'a', {{glod}} isn't a helper, and nothing in the story sets an attribute called glod, so it shows nothing. Did you mean {{gold}}?",
            "In section 'a', {{board}} isn't a helper, and nothing in the story sets an attribute called board, so it shows nothing.",
        ]);
        expect(diagnostics[0].range).toEqual({ start: { line: 2, character: 9 }, end: { line: 2, character: 17 } });
        expect(diagnostics[0].severity).toBe("warning");
    });

    test("not for helpers, Squiffy's own attributes or embed parameters", async () => {
        const text = [
            "[[a]]:",
            "{{clear}} {{restart}} {{saves}} {{turns}} {{previous}} {{_section}} {{content}}",
            "{{embed \"b\" who=\"Ann\"}}",
            "@end",
            "",
            "[[b]]:",
            "{{who}} says hi.",
            "@end",
        ].join("\n");
        expect(await unknownNames({ "s.squiffy": text })).toEqual([]);
    });

    test("not for attributes the story sets, however it sets them", async () => {
        const text = [
            "[[a]]:",
            "@set a = 1",
            "@inc b",
            "{{set \"c\" 1}}",
            "<input data-attribute=\"d\">",
            "    squiffy.set(\"e\", 1);",
            "[[Go]](b, f = 2, hero.hp = 3)",
            "{{a}} {{b}} {{c}} {{d}} {{e}} {{f}} {{hero.hp}} {{hero}}",
            "",
            "[[b]]:",
            "@end",
        ].join("\n");
        expect(await unknownNames({ "s.squiffy": text })).toEqual([]);
    });

    test("not for names the story's JavaScript sets, or helpers it registers", async () => {
        const files = {
            "s.squiffy": "@ui ui.js\n@import story.js\n\n[[a]]:\n{{board}} {{score}} {{inline}} {{missing}}\n@end\n\n@ui\n    squiffy.registerHelper('inline', () => 1);",
            "ui.js": "squiffy.registerHelper(\"board\", () => \"\");",
            "story.js": "squiffy.set(`score`, 0);",
        };
        expect(await unknownNames(files)).toEqual(["missing"]);
    });

    test("not for names the JavaScript in a folder's .js files sets", async () => {
        const files = {
            "squiffy.json": "{ \"version\": 1, \"main\": \"s.squiffy\" }",
            "s.squiffy": "[[a]]:\n{{score}} {{missing}}\n@end",
            "scripts/game.js": "squiffy.set(\"score\", 0);",
        };
        expect(await unknownNames(files)).toEqual(["missing"]);
    });

    test("is a warning when the story is built", async () => {
        const warnings: string[] = [];
        const result = await compile({ scriptBaseFilename: "s.squiffy", script: "[[a]]:\n{{board}}", onWarning: w => warnings.push(w) });
        expect(result.success).toBe(true);
        expect(warnings).toEqual([
            "WARNING: s.squiffy line 2: In section 'a', {{board}} isn't a helper, and nothing in the story sets an attribute called board, so it shows nothing.",
        ]);
    });
});

describe("squiffy-ignore comments", () => {
    test("turn off a warning in the section they're in", async () => {
        const text = "[[a]]:\n{{!-- squiffy-ignore unknown-name --}}\n{{board}} [[b]]\n\n[[b]]:\n{{board}}\n@end";
        const diagnostics = (await service({ "s.squiffy": text }).getAllDiagnostics()).filter(d => d.code == "squiffy/unknown-name");
        expect(diagnostics.map(d => d.range.start.line)).toEqual([5]);
    });

    test("can name what to turn it off for", async () => {
        const text = "[[a]]:\n{{! squiffy-ignore squiffy/unknown-name board, score }}\n{{board}} {{score}} {{other}}\n@end";
        expect(await unknownNames({ "s.squiffy": text })).toEqual(["other"]);
    });

    test("in the master section, turn off a warning everywhere", async () => {
        const files = {
            "s.squiffy": "@import other.squiffy\n\n[[]]:\n{{!-- squiffy-ignore unknown-name board --}}\n\n[[a]]:\n{{board}} {{other}} [[b]]",
            "other.squiffy": "[[b]]:\n{{board}}\n@end",
        };
        expect(await unknownNames(files)).toEqual(["other"]);
    });

    test("turn off the story map's warnings, and sound on the first screen", async () => {
        const text = "[[a]]:\n@music theme.mp3\n{{!-- squiffy-ignore sound-on-first-screen --}}\n{{!-- squiffy-ignore dead-end --}}\nThe end.\n\n[[draft]]:\n{{!-- squiffy-ignore unreachable-section --}}\n@end";
        expect(await service({ "s.squiffy": text }).getAllDiagnostics()).toEqual([]);
    });

    test("turn off warnings when the story is built, but not errors", async () => {
        const warnings: string[] = [];
        const result = await compile({
            scriptBaseFilename: "s.squiffy",
            script: "[[a]]:\n{{!-- squiffy-ignore unknown-name --}}\n{{!-- squiffy-ignore template-syntax --}}\n{{board}} {{#if x}}",
            onWarning: w => warnings.push(w),
        });
        expect(warnings).toEqual([]);
        expect(result.success).toBe(false);
    });

    test("squiffy.json's \"ignore\" turns warnings off for the whole story", async () => {
        const files = {
            "squiffy.json": JSON.stringify({ version: 1, main: "s.squiffy", ignore: ["dead-end", "unknown-name board"] }),
            "s.squiffy": "[[a]]:\n{{board}} {{other}} [[b]] [[c]]\n\n[[b]]:\nNo way out.\n\n[[c]]:\nNor here.",
        };
        const diagnostics = await service(files).getAllDiagnostics();
        expect(diagnostics.map(d => [d.code, d.subject])).toEqual([["squiffy/unknown-name", "other"]]);
    });

    test("squiffy.json's \"ignore\" turns warnings off when the story is built", async () => {
        const warnings: string[] = [];
        await compile({ scriptBaseFilename: "s.squiffy", script: "{{board}} {{other}}", ignore: ["unknown-name board"], onWarning: w => warnings.push(w) });
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("{{other}}");
    });

    test("are added by a quick fix", async () => {
        const text = "[[a]]:\n@set gold = 1\n    var x = 1;\n{{board}} [[b]]\n\n[[b]]:\n@end\n\n[[]]:\n@set y = 1";
        const ls = service({ "s.squiffy": text });
        const diagnostic = (await ls.getAllDiagnostics()).find(d => d.code == "squiffy/unknown-name")!;
        const actions = await ls.getCodeActions("s.squiffy", diagnostic.range);
        expect(actions.map(a => a.title)).toEqual(["Ignore {{board}} in this section", "Ignore {{board}} everywhere"]);
        // Not offered at the cursor, so silencing a warning isn't the easy thing to do (#677)
        expect(actions.some(a => a.isPreferred)).toBe(false);
        expect(apply(text, actions[0].edit["s.squiffy"]))
            .toBe("[[a]]:\n@set gold = 1\n    var x = 1;\n{{!-- squiffy-ignore unknown-name board --}}\n{{board}} [[b]]\n\n[[b]]:\n@end\n\n[[]]:\n@set y = 1");
        expect(apply(text, actions[1].edit["s.squiffy"])).toBe(text + "\n{{!-- squiffy-ignore unknown-name board --}}");

        ls.updateFile("s.squiffy", apply(text, actions[1].edit["s.squiffy"]));
        expect((await ls.getAllDiagnostics()).filter(d => d.code == "squiffy/unknown-name")).toEqual([]);
    });

    test("a quick fix turns off sound on the first screen", async () => {
        const text = "[[a]]:\n@music theme.mp3\n[[b]]\n\n[[b]]:\n@end";
        const ls = service({ "s.squiffy": text });
        const diagnostic = (await ls.getAllDiagnostics()).find(d => d.code == "squiffy/sound-on-first-screen")!;
        const actions = await ls.getCodeActions("s.squiffy", diagnostic.range);
        expect(actions.map(a => a.title)).toEqual(["Ignore this warning in this section"]);
        expect(apply(text, actions[0].edit["s.squiffy"])).toBe("[[a]]:\n@music theme.mp3\n{{!-- squiffy-ignore sound-on-first-screen --}}\n[[b]]\n\n[[b]]:\n@end");
    });
});
