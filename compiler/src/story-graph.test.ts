import { beforeAll, describe, expect, test, vi } from "vitest";

import { createLanguageService, ProjectFiles, WorkspaceEdit } from "./language-service.js";
import { parse } from "./parse.js";
import type { GraphEdge, StoryGraph } from "./story-graph.js";

beforeAll(() => {
    vi.stubGlobal("crypto", {
        randomUUID: () => "00000000-0000-0000-0000-000000000000"
    });
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

function service(files: Record<string, string>, mainFile = "story.squiffy") {
    return createLanguageService({ files: memoryFiles(files), mainFile });
}

async function graphOf(files: Record<string, string>) {
    return service(files).getStoryGraph();
}

const one = (main: string) => graphOf({ "story.squiffy": main });

const nodeOf = (graph: StoryGraph, id: string) => {
    const node = graph.nodes.find(n => n.id == id);
    if (!node) throw new Error(`No node ${id}: ${graph.nodes.map(n => n.id).join(", ")}`);
    return node;
};

// Each edge as "from -> to (kind)", with a ? for conditional ones
const edgeSummary = (edges: GraphEdge[]) =>
    edges.map(e => `${e.from} -> ${e.to ?? "?"} (${e.kind}${e.conditional ? ", conditional" : ""})`);

const reachable = (graph: StoryGraph) => graph.nodes.filter(n => n.reachable).map(n => n.id);
const deadEnds = (graph: StoryGraph) => graph.nodes.filter(n => n.deadEnd).map(n => n.id);

function apply(text: string, edits: WorkspaceEdit[string]) {
    const lines = text.split("\n");
    const offset = (p: { line: number; character: number }) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
    const sorted = [...edits].sort((a, b) => offset(b.range.start) - offset(a.range.start));
    for (const edit of sorted) {
        text = text.substring(0, offset(edit.range.start)) + edit.newText + text.substring(offset(edit.range.end));
    }
    return text;
}

describe("story graph", () => {
    test("sections, passages and the links between them", async () => {
        const main = "[[start]]:\nGo [[north]](cave, gold+=1, seen) or [look].\n\n[look]:\nNothing. [[Leave]](cave)\n\n[[cave]]:\n@end\nDark.";
        const graph = await one(main);
        expect(graph.nodes.map(n => [n.id, n.kind, n.name, n.section])).toEqual([
            ["section:start", "section", "start", undefined],
            ["passage:start/look", "passage", "look", "start"],
            ["section:cave", "section", "cave", undefined],
        ]);
        expect(nodeOf(graph, "section:start").start).toBe(true);
        expect(nodeOf(graph, "section:cave").location).toEqual({
            file: "story.squiffy", range: { start: { line: 6, character: 2 }, end: { line: 6, character: 6 } },
        });
        expect(edgeSummary(graph.edges)).toEqual([
            "section:start -> section:cave (section-link)",
            "section:start -> passage:start/look (passage-link)",
            "passage:start/look -> section:cave (section-link)",
        ]);
        expect(graph.edges[0]).toMatchObject({ text: "north", setters: ["gold+=1", "seen"] });
        expect(graph.edges[0].location.range.start).toEqual({ line: 1, character: 3 });
        expect(graph.edges[1]).toMatchObject({ text: "look" });
        expect(graph.edges[1].setters).toBeUndefined();
        expect(reachable(graph)).toEqual(["section:start", "passage:start/look", "section:cave"]);
        expect(nodeOf(graph, "section:cave").ending).toBe(true);
        expect(deadEnds(graph)).toEqual([]);
    });

    test("ids stay the same when unrelated text changes", async () => {
        const before = await one("[[a]]:\n[[b]]\n\n[[b]]:\n@end");
        const after = await one("Intro\n\n[[a]]:\nMore text.\n[[b]]\n\n[[b]]:\n@end\nThe end.");
        expect(after.nodes.map(n => n.id)).toEqual(["section:_default", ...before.nodes.map(n => n.id)]);
    });

    test("across files", async () => {
        const graph = await graphOf({
            "story.squiffy": "[[start]]:\n@import chapters/*.squiffy\nGo to [[cellar]].",
            "chapters/cellar.squiffy": "[[cellar]]:\nBack [[up]](start), or on to [[attic]].",
            "chapters/attic.squiffy": "[[attic]]:\n@end",
        });
        expect(edgeSummary(graph.edges)).toEqual([
            "section:start -> section:cellar (section-link)",
            "section:cellar -> section:start (section-link)",
            "section:cellar -> section:attic (section-link)",
        ]);
        expect(nodeOf(graph, "section:attic").location.file).toBe("chapters/attic.squiffy");
        expect(graph.edges[2].location.file).toBe("chapters/cellar.squiffy");
        expect(reachable(graph).sort()).toEqual(["section:attic", "section:cellar", "section:start"]);
    });

    test("+++ and [[next>]] links", async () => {
        const graph = await one("[[a]]:\nOne\n+++Onward\nTwo [[More>]]\n\n---\nThree\n@end");
        expect(edgeSummary(graph.edges)).toEqual([
            "section:a -> section:_continue1 (section-link)",
            "section:_continue1 -> section:_continue2 (section-link)",
        ]);
        expect(graph.edges[0]).toMatchObject({ text: "Onward", location: { range: { start: { line: 2, character: 0 } } } });
        expect(reachable(graph)).toEqual(["section:a", "section:_continue1", "section:_continue2"]);
    });

    test("embeds include content, but don't make what they embed reachable", async () => {
        const graph = await one("[[a]]:\n{{embed \"shared\"}}\n\n[[shared]]:\nGo to [[b]].\n\n[[b]]:\n@end");
        expect(edgeSummary(graph.edges)).toEqual([
            "section:a -> section:shared (embed)",
            "section:shared -> section:b (section-link)",
        ]);
        expect(reachable(graph)).toEqual(["section:a", "section:b"]);
        // a's way out is in what it embeds
        expect(deadEnds(graph)).toEqual([]);
        expect(nodeOf(graph, "section:shared").embedded).toBe(true);
    });

    test("an embed with parameters, or one that wraps text, is an embed too (#450)", async () => {
        const graph = await one("[[a]]:\n{{embed \"say\" who=\"Ann\"}} {{#embed \"box\"}}Hi{{/embed}}\n\n[[say]]:\n{{who}}\n\n[[box]]:\n{{content}}");
        expect(edgeSummary(graph.edges)).toEqual([
            "section:a -> section:say (embed)",
            "section:a -> section:box (embed)",
        ]);
        expect(nodeOf(graph, "section:say").embedded).toBe(true);
        expect(nodeOf(graph, "section:box").embedded).toBe(true);
    });

    test("{{goto}} is navigation, and an expression in it is an unknown exit", async () => {
        const graph = await one([
            "[[a]]:", "{{#if dead}}{{goto \"death\"}}{{/if}}", "[look]", "",
            "[look]:", "{{goto 'b'}}", "",
            "[[b]]:", "{{goto \"nowhere\" after=1000}}", "",
            "[[c]]:", "{{goto (random (array \"a\" \"b\"))}}", "",
            "[[death]]:", "@end",
        ].join("\n"));
        expect(edgeSummary(graph.edges)).toEqual([
            "section:a -> section:death (goto, conditional)",
            "section:a -> passage:a/look (passage-link)",
            "passage:a/look -> section:b (goto)",
            "section:b -> ? (goto)",
        ]);
        expect(graph.edges[3].target).toBe("nowhere");
        expect(reachable(graph)).toEqual(["section:a", "passage:a/look", "section:b", "section:death"]);
        expect(graph.nodes.filter(n => n.unknownExits).map(n => n.id)).toEqual(["section:c"]);
        expect(deadEnds(graph)).toEqual([]);
    });

    test("{{goto}} inside {{#every}} is conditional (#451)", async () => {
        const graph = await one([
            "[[a]]:", "{{#every 1000}}{{goto \"b\"}}{{/every}} [[Stay]](a)", "",
            "[[b]]:", "@end",
        ].join("\n"));
        expect(edgeSummary(graph.edges)).toEqual([
            "section:a -> section:b (goto, conditional)",
            "section:a -> section:a (section-link)",
        ]);
        expect(reachable(graph)).toEqual(["section:a", "section:b"]);
    });

    test("{{deactivate}} isn't a link, so it doesn't reach a passage (#13)", async () => {
        const graph = await one([
            "[[a]]:", "See [b].", "",
            "[b]:", "{{deactivate \"c\"}}", "",
            "[c]:", "Nothing links here.", "",
            "[[d]]:", "@end",
        ].join("\n"));
        expect(edgeSummary(graph.edges)).toEqual(["section:a -> passage:a/b (passage-link)"]);
        expect(reachable(graph)).toEqual(["section:a", "passage:a/b"]);
    });

    test("{{goto}} names can be followed, found, renamed and completed", async () => {
        const main = "[[a]]:\n{{goto \"b\"}}\n\n[[b]]:\n@end\n{{goto \"";
        const ls = service({ "story.squiffy": main });
        const position = { line: 1, character: 9 };
        expect(await ls.getDefinition("story.squiffy", position)).toEqual({
            file: "story.squiffy", range: { start: { line: 3, character: 2 }, end: { line: 3, character: 3 } },
        });
        expect(await ls.getReferences("story.squiffy", position, false)).toEqual([
            { file: "story.squiffy", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } } },
        ]);
        const rename = await ls.getRenameEdits("story.squiffy", position, "end");
        expect(rename && "edit" in rename && apply(main, rename.edit!["story.squiffy"])).toBe("[[a]]:\n{{goto \"end\"}}\n\n[[end]]:\n@end\n{{goto \"");
        const items = await ls.getCompletions("story.squiffy", { line: 5, character: 8 });
        expect(items.map(i => i.label)).toEqual(["a", "b"]);
    });


    test("a text box with data-section or data-passage is a link (#454)", async () => {
        const main = [
            "[[a]]:", "Name: <input type=\"text\" data-attribute=\"name\" data-passage=\"greet\">", "",
            "[greet]:", "Hello. <input data-attribute='x' data-section='b' required>", "",
            "[[b]]:", "<input data-section=c>", "",
            "[[c]]:", "@end",
        ].join("\n");
        const graph = await one(main);
        expect(edgeSummary(graph.edges)).toEqual([
            "section:a -> passage:a/greet (passage-link)",
            "passage:a/greet -> section:b (section-link)",
            "section:b -> section:c (section-link)",
        ]);
        expect(reachable(graph)).toEqual(["section:a", "passage:a/greet", "section:b", "section:c"]);
        expect(deadEnds(graph)).toEqual([]);

        const ls = service({ "story.squiffy": main });
        const position = { line: 4, character: 50 };
        expect(await ls.getDefinition("story.squiffy", position)).toEqual({
            file: "story.squiffy", range: { start: { line: 6, character: 2 }, end: { line: 6, character: 3 } },
        });
        const rename = await ls.getRenameEdits("story.squiffy", position, "room");
        expect(rename && "edit" in rename && apply(main, rename.edit!["story.squiffy"]))
            .toBe(main.replace("data-section='b'", "data-section='room'").replace("[[b]]:", "[[room]]:"));
        const unquoted = await ls.getRenameEdits("story.squiffy", { line: 7, character: 20 }, "d");
        expect(unquoted && "edit" in unquoted && apply(main, unquoted.edit!["story.squiffy"]))
            .toBe(main.replace("data-section=c", "data-section=d").replace("[[c]]:", "[[d]]:"));
    });

    test("a text box going nowhere is a warning, and its target is completed (#454)", async () => {
        const main = "[[a]]:\n<input data-section=\"nowhere\"> <input data-passage=\"nothing\">\n<input data-passage=\"\n[p]:\nHi.\n\n[[b]]:\n<input data-section=\"";
        const ls = service({ "story.squiffy": main });
        const diagnostics = await ls.getDiagnostics("story.squiffy");
        expect(diagnostics.filter(d => d.code.includes("unknown")).map(d => [d.code, d.message])).toEqual([
            ["squiffy/unknown-section-link", "In section 'a' there is a text box that goes to a section called \"nowhere\" when Enter is pressed, which doesn't exist"],
            ["squiffy/unknown-passage-link", "In section 'a' there is a text box that goes to a passage called \"nothing\" when Enter is pressed, which doesn't exist"],
        ]);
        expect((await ls.getCompletions("story.squiffy", { line: 2, character: 21 })).map(i => i.label)).toEqual(["p"]);
        expect((await ls.getCompletions("story.squiffy", { line: 7, character: 21 })).map(i => i.label)).toEqual(["a", "b"]);
    });
    test("links inside {{#if}} are conditional, and can be followed", async () => {
        const graph = await one("[[a]]:\n{{#if key}}\nOpen the [[door]].\n{{else}}\nIt's locked. [[Back]](a)\n{{/if}}\n[[Wait]](a)\n\n[[door]]:\n@end");
        expect(edgeSummary(graph.edges)).toEqual([
            "section:a -> section:door (section-link, conditional)",
            "section:a -> section:a (section-link, conditional)",
            "section:a -> section:a (section-link)",
        ]);
        expect(nodeOf(graph, "section:door").reachable).toBe(true);
    });

    test("broken links have no target, and count as a way out", async () => {
        const graph = await one("[[a]]:\nGo to [[nowhere]] or [nothing].");
        expect(edgeSummary(graph.edges)).toEqual([
            "section:a -> ? (section-link)",
            "section:a -> ? (passage-link)",
        ]);
        expect(deadEnds(graph)).toEqual([]);
    });

    test("dynamic links and JavaScript navigation are unknown exits", async () => {
        const graph = await one([
            "[[a]]:", "[[Go]]({{destination}})", "",
            "[[b]]:", "    squiffy.story.go(squiffy.get(\"next\"));", "",
            "[[c]]:", "{{section \"d\" text=\"Go\"}}", "",
            "[[d]]:", "    squiffy.story.go(\"e\");", "",
            "[[e]]:", "@end",
        ].join("\n"));
        expect(graph.nodes.filter(n => n.unknownExits).map(n => n.id)).toEqual(["section:a", "section:b", "section:c"]);
        expect(graph.edges[0]).toMatchObject({ from: "section:a", dynamic: true });
        expect(graph.edges[0].to).toBeUndefined();
        expect(edgeSummary(graph.edges.slice(1))).toEqual(["section:d -> section:e (script)"]);
        expect(deadEnds(graph)).toEqual([]);
    });

    test("passages are reachable when something links to them, and special ones with their section", async () => {
        const graph = await one("[[a]]:\n[one]\n\n[one]:\nx\n\n[two]:\ny\n\n[@last]:\nz\n\n[]:\nAlways\n@end");
        expect(reachable(graph)).toEqual(["section:a", "passage:a/one", "passage:a/@last", "passage:a/"]);
    });

    test("the master section is part of every section", async () => {
        const graph = await one("[[]]:\n[[Restart]](a)\n\n[[a]]:\nHello.");
        expect(nodeOf(graph, "section:").reachable).toBe(true);
        expect(deadEnds(graph)).toEqual([]);
    });

    test("@start sets where reachability starts from", async () => {
        const graph = await one("@start b\n\n[[a]]:\n[[b]]\n\n[[b]]:\n@end");
        expect(nodeOf(graph, "section:b").start).toBe(true);
        expect(reachable(graph)).toEqual(["section:b"]);
    });

    test("endings, in a section or one of its passages", async () => {
        const graph = await one("[[a]]:\n[[b]] [[c]] [[d]]\n\n[[b]]:\nThe end.\n@end\n\n[[c]]:\n[die]\n\n[die]:\n@end\n\n[[d]]:\nOops.");
        expect(graph.nodes.filter(n => n.ending).map(n => n.id)).toEqual(["section:b", "section:c"]);
        expect(deadEnds(graph)).toEqual(["section:d"]);
    });
});

describe("@end", () => {
    test("is parsed as a directive, which the compiler ignores", async () => {
        const file = parse("[[a]]:\n@end\nText");
        expect(file.sections[0].type == "section" && file.sections[0].body.map(n => n.type)).toEqual(["end", "text"]);
        const analysis = await service({ "story.squiffy": "[[a]]:\n@end\nText" }).getAnalysis();
        expect(analysis.success).toBe(true);
    });

    test("is offered as a completion", async () => {
        const ls = service({ "story.squiffy": "[[a]]:\n@e" });
        const items = await ls.getCompletions("story.squiffy", { line: 1, character: 2 });
        expect(items.find(i => i.label == "@end")).toMatchObject({
            kind: "directive", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } },
        });
    });
});

describe("for the story map", () => {
    test("sections without names of their own are labelled as in the outline", async () => {
        const graph = await one("Hello.\n[[Go]](a)\n\n[[a]]:\nOne.\n+++More\nTwo.\n---\nThree.");
        expect(graph.nodes.filter(n => n.kind == "section").map(n => [n.name, n.detail])).toEqual([
            ["_default", "(Start)"], ["a", undefined], ["_continue1", "+++More"], ["_continue2", "---"],
        ]);
    });

    test("where a new link goes: the end of the section's own text, or the passage's", async () => {
        const graph = await one("[[a]]:\nOne.\nTwo.\n\n[p]:\nPassage.\n\n\n[[b]]:\n\n[[c]]:\n@set x\n");
        expect(nodeOf(graph, "section:a").contentEnd).toEqual({ line: 2, character: 4 });
        expect(nodeOf(graph, "passage:a/p").contentEnd).toEqual({ line: 5, character: 8 });
        // Only a header: after it
        expect(nodeOf(graph, "section:b").contentEnd).toEqual({ line: 8, character: 6 });
        expect(nodeOf(graph, "section:c").contentEnd).toEqual({ line: 11, character: 6 });
    });

    test("a broken link or embed says what it's written with", async () => {
        const graph = await one("[[a]]:\n[[Go]](nowhere, x=1) [[elsewhere]] [gone] {{embed \"lost\"}} [[x]]({{dest}})");
        expect(graph.edges.map(e => [e.to, e.target])).toEqual([
            [undefined, "nowhere"], [undefined, "elsewhere"], [undefined, "gone"], [undefined, "lost"], [undefined, undefined],
        ]);
    });
});

describe("live sections and passages", () => {
    test("{{live}} with section= or passage= shows its text, so its links can be followed", async () => {
        const graph = await one(`[[a]]:
Score: {{live "score" section="panel"}} {{live "x" passage="info"}} {{live "y" section="nowhere"}}

[info]:
[[c]]

[[panel]]:
{{#if x}}[[b]]{{/if}}

[[b]]:
@end

[[c]]:
@end`);
        expect(edgeSummary(graph.edges.filter(e => e.kind == "embed"))).toEqual([
            "section:a -> section:panel (embed)",
            "section:a -> passage:a/info (embed)",
            "section:a -> ? (embed)",
        ]);
        expect(graph.edges.find(e => e.kind == "embed" && !e.to)?.target).toBe("nowhere");
        // Through the panel, b can be reached, and a isn't a dead end
        expect(nodeOf(graph, "section:b").reachable).toBe(true);
        expect(nodeOf(graph, "section:c").reachable).toBe(true);
        expect(nodeOf(graph, "section:a").deadEnd).toBe(false);
        // Embedding doesn't make the panel itself somewhere the player goes, but it's shown
        expect(nodeOf(graph, "section:panel")).toMatchObject({ reachable: false, embedded: true });
    });
});

describe("diagnostics", () => {
    test("unreachable sections and dead ends", async () => {
        const main = "[[a]]:\nGo to [[b]].\n\n[[b]]:\nStuck.\n\n[[c]]:\nGo to [[a]].";
        const ls = service({ "story.squiffy": main });
        const diagnostics = await ls.getDiagnostics("story.squiffy");
        expect(diagnostics.map(d => [d.code, d.severity, d.range.start.line])).toEqual([
            ["squiffy/dead-end", "warning", 3],
            ["squiffy/unreachable-section", "warning", 6],
        ]);
    });

    test("a section without a name of its own is called by its +++ or --- line, not its internal name", async () => {
        const messages = async (main: string) =>
            (await service({ "story.squiffy": main }).getDiagnostics("story.squiffy")).map(d => d.message);
        expect(await messages("Hello.\n+++Continue...\nStuck.")).toEqual([
            "The \"+++Continue...\" has no way out, as it has no links to another section. If it's one of the story's endings, add @end to say so.",
        ]);
        expect(await messages("[[a]]:\nGo to [[b]].\n\n[[b]]:\n@end\n\n---\nNothing links here.\n[[a]]")).toEqual([
            "The \"---\" after \"b\" can't be reached from the start of the story, as nothing the player can reach links to it.",
        ]);
        expect(await messages("Hello.")).toEqual([
            "The text before the first section has no way out, as it has no links to another section. If it's one of the story's endings, add @end to say so.",
        ]);
    });

    test("section labels say which named section they come after, and which one if there are several", async () => {
        const graph = await one("Hi.\n+++Continue...\nA.\n+++Continue...\nB.\n\n[[cave]]:\nC.\n+++Continue...\nD.\n+++Onwards\nE.\n+++Continue...\nF.\n---\nG.");
        const labels = graph.nodes.filter(n => n.kind == "section" && n.name != "").map(n => n.label);
        expect(labels).toEqual([
            "the text before the first section",
            "the first \"+++Continue...\"",
            "the second \"+++Continue...\"",
            "the section \"cave\"",
            "the first \"+++Continue...\" after \"cave\"",
            "the \"+++Onwards\" after \"cave\"",
            "the second \"+++Continue...\" after \"cave\"",
            "the \"---\" after \"cave\"",
        ]);
    });

    test("a quick fix marks a dead end as an ending", async () => {
        const main = "[[a]]:\nGo to [[b]].\n\n[[b]]:\nThe end.";
        const ls = service({ "story.squiffy": main });
        const [diagnostic] = await ls.getDiagnostics("story.squiffy");
        const [action] = await ls.getCodeActions("story.squiffy", diagnostic.range);
        expect(action.title).toBe("Mark this section as an ending");
        const fixed = apply(main, action.edit["story.squiffy"]);
        expect(fixed).toBe("[[a]]:\nGo to [[b]].\n\n[[b]]:\n@end\nThe end.");
        ls.updateFile("story.squiffy", fixed);
        expect(await ls.getDiagnostics("story.squiffy")).toEqual([]);
    });

    test("the quick fix works on a header at the end of the file, and on the text before any section", async () => {
        for (const [main, expected] of [["[[a]]:", "[[a]]:\n@end"], ["Hello.", "@end\nHello."]]) {
            const ls = service({ "story.squiffy": main });
            const [diagnostic] = await ls.getDiagnostics("story.squiffy");
            expect(diagnostic.code).toBe("squiffy/dead-end");
            const [action] = await ls.getCodeActions("story.squiffy", diagnostic.range);
            expect(apply(main, action.edit["story.squiffy"])).toBe(expected);
        }
    });

    test("a section that's only shown inside others isn't unreachable, or a dead end", async () => {
        const ls = service({ "story.squiffy": "[[a]]:\n{{live \"x\" section=\"panel\"}} {{embed \"shared\"}} [[b]]\n\n[[panel]]:\nJust text.\n\n[[shared]]:\nMore text.\n\n[[b]]:\n@end" });
        expect(await ls.getDiagnostics("story.squiffy")).toEqual([]);
    });

    test("no unreachable sections when something navigates somewhere that can't be known", async () => {
        const ls = service({ "story.squiffy": "[[a]]:\n    squiffy.story.go(squiffy.get(\"room\"));\n\n[[b]]:\n@end" });
        expect(await ls.getDiagnostics("story.squiffy")).toEqual([]);
    });
});
