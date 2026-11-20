import { expect, test, vi, beforeAll } from "vitest";
import * as fs from "fs/promises";
import { glob } from "glob";
import * as path from "path";

import { compile, CompileSuccess } from "./compiler.js";
import { analyse } from "./analyse.js";

// Mock crypto.randomUUID() to return a stable value for snapshot tests
beforeAll(() => {
    const mockUUID = "00000000-0000-0000-0000-000000000000";
    vi.stubGlobal("crypto", {
        randomUUID: () => mockUUID
    });
});

const externalFiles = (inputFilename: string) => {
    const includedFiles = [path.resolve(inputFilename)];
    const basePath = path.resolve(path.dirname(inputFilename));
    return {
        getMatchingFilenames: async (pattern: string): Promise<string[]> => {
            const filenames = path.join(basePath, pattern);
            const result = await glob(filenames);
            return result.filter((filename: string) => !includedFiles.includes(filename));
        },
        getContent: async (filename: string): Promise<string> => {
            // Resolve relative paths against basePath
            const resolvedPath = path.isAbsolute(filename) ? filename : path.join(basePath, filename);
            includedFiles.push(resolvedPath);
            return (await fs.readFile(resolvedPath)).toString();
        },
        getLocalFilename(filename: string): string {
            return path.relative(basePath, filename);
        }
    };
};

function assertSuccess(obj: unknown): asserts obj is CompileSuccess {
    if (!obj || typeof obj !== "object" || !("success" in obj) || !obj.success) {
        throw new Error("Expected success");
    }
}

test('"Hello world" should compile', async () => {
    const result = await compile({
        scriptBaseFilename: "filename.squiffy",
        script: "hello world",
    });

    assertSuccess(result);
    expect(result.output.story.start).toBe("_default");
    expect(Object.keys(result.output.story.sections).length).toBe(1);
    expect(result.output.story.sections._default.text).toBe("hello world");
});

test("Blank game should compile", async () => {
    const result = await compile({
        scriptBaseFilename: "filename.squiffy",
        script: "",
    });

    assertSuccess(result);
    expect(result.output.story.start).toBe("_default");
    expect(Object.keys(result.output.story.sections).length).toBe(1);
    expect(result.output.story.sections._default.text).toBe("");
});

// Story files to compile, relative to the folder they're in. The fixtures each show a feature,
// with Squiffy 6's rules for setters (no squiffy.json). The examples are the complete stories on
// the docs site, which have a squiffy.json, so they use Squiffy 7's.
const fixturesDir = "test/fixtures";
const examplesDir = "../examples";

const examples = [
    ...[
        "animate/animate.squiffy",
        "attributes/attributes.squiffy",
        "clearscreen/clearscreen.squiffy",
        "continue/continue.squiffy",
        "helloworld/helloworld.squiffy",
        "import/test.squiffy",
        "input/input.squiffy",
        "last/last.squiffy",
        "link-attributes/link-attributes.squiffy",
        "live/live.squiffy",
        "master/master.squiffy",
        "replace/replace.squiffy",
        "rotate/rotate.squiffy",
        "sectiontrack/sectiontrack.squiffy",
        "start/start.squiffy",
        "test/example.squiffy",
        "textprocessor/textprocessor.squiffy",
        "transitions/transitions.squiffy",
        "turncount/turncount.squiffy",
    ].map(file => ({ dir: fixturesDir, file, expressions: false })),
    ...[
        "coffeeshop/coffeeshop.squiffy",
        "gameshow/gameshow.squiffy",
    ].map(file => ({ dir: examplesDir, file, expressions: true })),
];

for (const { dir, file: example, expressions } of examples) {
    test(example, async () => {
        const script = await fs.readFile(`${dir}/${example}`, "utf8");
        const filename = path.basename(example);
        const warnings: string[] = [];

        const result = await compile({
            scriptBaseFilename: filename,
            script: script,
            onWarning: (message) => {
                console.warn(message);
                warnings.push(message);
            },
            externalFiles: externalFiles(`${dir}/${example}`),
            expressions,
        });

        assertSuccess(result);
        expect(await result.getJs(true)).toMatchSnapshot();
        expect(warnings.length).toBe(0);
    });
}

const warningExamples = [
    "warnings/warnings.squiffy",
    "warnings/warnings2.squiffy",
];

for (const example of warningExamples) {
    test(example, async () => {
        const script = await fs.readFile(`${fixturesDir}/${example}`, "utf8");
        const filename = path.basename(example);

        const warnings: string[] = [];

        await compile({
            scriptBaseFilename: filename,
            script: script,
            onWarning: (message) => warnings.push(message)
        });

        expect(warnings).toMatchSnapshot();
    });
}

test("Error: passage without section", async () => {
    const script = `
[my passage]:
This is a passage without a section.
`;

    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain("Can't add passage");
        expect(result.errors[0]).toContain("my passage");
        expect(result.errors[0]).toContain("no section has been created");
    }
});

test("Error: unexpected text in @ui block", async () => {
    const script = `
@ui
    console.log("valid js");
This text should not be here
---

Some content
`;

    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain("Unexpected text in @ui block");
    }
});

test("Compiler stops at first error", async () => {
    const script = `
[passage1]:
No section for this passage

[passage2]:
Another orphaned passage
`;

    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
        // Compiler stops at first error, so only passage1 error is reported
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain("passage1");
    }
});

test("Next-section link [[text>]] should link to section after ---", async () => {
    const script = `
[[intro]]:
Welcome!

[[Continue>]]

---

This is the second section.
`;

    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
    });

    assertSuccess(result);
    // Should have two sections: intro and _continue1
    expect(Object.keys(result.output.story.sections)).toEqual(["intro", "_continue1"]);
    // The intro section should have a link to _continue1
    expect(result.output.story.sections.intro.text).toContain('{{section "_continue1" text="Continue"}}');
});

test("Links in a comment aren't links, even after a }}", async () => {
    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: "[[a]]:\n{{!-- {x}} [[b]] [c] --}} [[d]]\n\n[[d]]:\nD",
    });

    assertSuccess(result);
    expect(result.output.story.sections.a.text.trim()).toBe('{{!-- {x}} [[b]] [c] --}} {{section "d"}}');
});

test("A named link whose text ends with > isn't a next-section link", async () => {
    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: "[[a]]:\n[[<i>Go</i>]](c) [[Next>]](c)\n\n[[b]]:\nB\n\n[[c]]:\nC",
    });

    assertSuccess(result);
    expect(result.output.story.sections.a.text).toContain('{{section "c" text="<i>Go</i>"}} {{section "c" text="Next>"}}');
});

test("Named next-section link [[text]](>) should link to section after ---", async () => {
    const script = `
[[start]]:
Begin here.

[[Go forward]](>)

---

You moved forward.
`;

    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
    });

    assertSuccess(result);
    expect(Object.keys(result.output.story.sections)).toEqual(["start", "_continue1"]);
    expect(result.output.story.sections.start.text).toContain('{{section "_continue1" text="Go forward"}}');
});

test("Named next-section link [[text]](>, attr=value) should set attributes", async () => {
    const script = `
[[start]]:
Choose wisely.

[[Take the gold]](>, treasure=gold)

---

You took the gold!
`;

    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
    });

    assertSuccess(result);
    // Note: space before setter is preserved from the original syntax ", treasure=gold"
    expect(result.output.story.sections.start.text).toContain('{{section "_continue1" text="Take the gold" set=" treasure=gold"}}');
});

test("A story with expressions is flagged in the output, and keeps link setters as written (#373)", async () => {
    const script = `[[start]]:
[[Buy]](shop, gold -= price, message = "Hi,  there")
{{section "shop" set="x = 1"}}

[[shop]]:
Shop.`;
    const result = await compile({ scriptBaseFilename: "test.squiffy", script, expressions: true });

    assertSuccess(result);
    expect(result.output.story.expressions).toBe(true);
    expect(result.output.story.sections.start.text).toContain('{{section "shop" text="Buy" set=" gold -= price, message = \\"Hi,  there\\""}}');
    expect(await result.getJs()).toContain("story.expressions = true;");
});

test("With expressions, link setters can have brackets in them", async () => {
    const script = `[[start]]:
[[Buy]](shop, gold *= (price - 1)) and [haggle](deal, x = ((a + 1) * 2)) (or not)

[deal]:
Done.

[[shop]]:
Shop.`;
    const result = await compile({ scriptBaseFilename: "test.squiffy", script, expressions: true });
    assertSuccess(result);
    const text = result.output.story.sections.start.text;
    expect(text).toContain('{{section "shop" text="Buy" set=" gold *= (price - 1)"}}');
    expect(text).toContain('{{passage "deal" text="haggle" set=" x = ((a + 1) * 2)"}} (or not)');
});

test("Without expressions, a link's target still ends at the first \")\", as in Squiffy 6", async () => {
    const result = await compile({ scriptBaseFilename: "test.squiffy", script: "[[start]]:\n[[Buy]](shop, a = (b)) x\n\n[[shop]]:\nS" });
    assertSuccess(result);
    expect(result.output.story.sections.start.text).toContain('{{section "shop" text="Buy" set=" a = (b"}}) x');
});

test("A story without expressions isn't flagged (#373)", async () => {
    const result = await compile({ scriptBaseFilename: "test.squiffy", script: "[[start]]:\nHello." });

    assertSuccess(result);
    expect(result.output.story.expressions).toBeUndefined();
    expect(await result.getJs()).not.toContain("story.expressions");
});

test("Warning when [[text>]] has no following section", async () => {
    const script = `
[[only]]:
This is the only section.

[[Nowhere to go>]]
`;

    const warnings: string[] = [];
    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
        onWarning: (message) => warnings.push(message),
    });

    assertSuccess(result);
    // First warning is about the [[text>]] link, second is from the fallback [[text]]
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    const nextSectionWarning = warnings.find(w => w.includes("[[Nowhere to go>]]"));
    expect(nextSectionWarning).toBeDefined();
    expect(nextSectionWarning).toContain("no following section exists");
});

test("A warning calls a section without a name of its own by its +++ line, not its internal name", async () => {
    const warnings: string[] = [];
    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: "[[cave]]:\nA cave.\n+++Continue...\nDark. [[Missing]]\n+++Continue...\n[look]\n\n[look]:\nSee [nothing].",
        onWarning: (message) => warnings.push(message),
    });

    assertSuccess(result);
    expect(warnings).toEqual([
        "WARNING: test.squiffy line 3: In the first \"+++Continue...\" after \"cave\" there is a link to a section called [[Missing]], which doesn't exist",
        "WARNING: test.squiffy line 8: In the second \"+++Continue...\" after \"cave\", passage 'look' there is a link to a passage called [nothing], which doesn't exist",
    ]);
});

test("Warning when [[text]](>) has no following section", async () => {
    const script = `
[[only]]:
This is the only section.

[[Dead end]](>)
`;

    const warnings: string[] = [];
    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
        onWarning: (message) => warnings.push(message),
    });

    assertSuccess(result);
    // First warning is about the [[text]](>) link, second is from the fallback [[text]]
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    const nextSectionWarning = warnings.find(w => w.includes("[[Dead end]](>)"));
    expect(nextSectionWarning).toBeDefined();
    expect(nextSectionWarning).toContain("no following section exists");
});

test("Snippet block is stripped from compiled output", async () => {
    const script = `
[snippet: Heal player]:
{{set "health" (+ (get "health") 1)}}

[[intro]]:
Normal section content here.
`;

    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
    });

    assertSuccess(result);
    // No section called "snippet: Heal player" should exist
    expect(Object.keys(result.output.story.sections)).not.toContain("snippet: Heal player");
    expect(Object.keys(result.output.story.sections)).toContain("intro");
    // Snippet content should not appear in compiled output
    expect(result.output.story.sections.intro.text).not.toContain("health");
});

test("Text after snippet block compiles correctly", async () => {
    const script = `
[[start]]:
Start content.

[snippet: My snippet]:
snippet content here

[[next]]:
Next content.
`;

    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
    });

    assertSuccess(result);
    expect(Object.keys(result.output.story.sections)).toEqual(["start", "next"]);
    expect(result.output.story.sections.start.text).toBe("Start content.\n");
    expect(result.output.story.sections.next.text).toBe("Next content.\n");
});

test("Snippet between two sections doesn't affect either section", async () => {
    const script = `
[[section1]]:
Content of section 1.

[snippet: My snippet]:
This should be ignored.

[[section2]]:
Content of section 2.
`;

    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
    });

    assertSuccess(result);
    expect(Object.keys(result.output.story.sections)).toEqual(["section1", "section2"]);
    expect(result.output.story.sections.section1.text).toBe("Content of section 1.\n");
    expect(result.output.story.sections.section2.text).toBe("Content of section 2.\n");
});

test("Snippet at end of file compiles cleanly", async () => {
    const script = `
[[intro]]:
Introduction here.

[snippet: Trailing snippet]:
This content should be ignored.
`;

    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
    });

    assertSuccess(result);
    expect(Object.keys(result.output.story.sections)).toEqual(["intro"]);
    expect(result.output.story.sections.intro.text).toBe("Introduction here.\n");
});

test("Section name containing double quotes is properly escaped in template", async () => {
    const script = `
[[start]]:
Go to [[my "section"]].

[[my "section"]]:
You made it.
`;

    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
    });

    assertSuccess(result);
    expect(result.output.story.sections.start.text).toContain('{{section "my \\"section\\""}}');
});

test("Passage name containing double quotes is properly escaped in template", async () => {
    const script = `
[[start]]:
Click [my "passage"].

[my "passage"]:
Passage content.
`;

    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
    });

    assertSuccess(result);
    expect(result.output.story.sections.start.text).toContain('{{passage "my \\"passage\\""}}');
});

test("No warning when section name contains a comma", async () => {
    const script = `
[[start]]:
Go to [[section has a comma, for example]].

[[section has a comma, for example]]:
You made it.
`;

    const warnings: string[] = [];
    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
        onWarning: (message) => warnings.push(message),
    });

    assertSuccess(result);
    expect(warnings.length).toBe(0);
});

test("Image links are not mistaken for passage links", async () => {
    const script = `
[[start]]:
Here is an image: ![a cat](cat.png).
And another: ![](logo.jpg).
`;

    const warnings: string[] = [];
    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
        onWarning: (message) => warnings.push(message),
    });

    assertSuccess(result);
    // Image markdown should be passed through unchanged
    expect(result.output.story.sections.start.text).toContain("![a cat](cat.png)");
    expect(result.output.story.sections.start.text).toContain("![](logo.jpg)");
    // No passage templates should be generated from the image links
    expect(result.output.story.sections.start.text).not.toContain('{{passage "cat.png"');
    expect(result.output.story.sections.start.text).not.toContain('{{passage "logo.jpg"');
    expect(warnings.length).toBe(0);
});
test("Square brackets inside Handlebars expressions are not converted to links", async () => {
    const script = `
[[start]]:
Second item: {{someArray.[1]}}.
Helper: {{someHelper "[x]"}}.
Triple: {{{someArray.[0]}}}.
{{#if x}}[[other]]{{/if}}
{{#if x}}[a]{{/if}}

[a]:
A passage.

[[other]]:
Other section.
`;

    const warnings: string[] = [];
    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
        onWarning: (message) => warnings.push(message),
    });

    assertSuccess(result);
    const text = result.output.story.sections.start.text;
    expect(text).toContain("Second item: {{someArray.[1]}}.");
    expect(text).toContain('Helper: {{someHelper "[x]"}}.');
    expect(text).toContain("Triple: {{{someArray.[0]}}}.");
    expect(text).toContain('{{#if x}}{{section "other"}}{{/if}}');
    expect(text).toContain('{{#if x}}{{passage "a"}}{{/if}}');
    expect(warnings).toEqual([]);
});

test("Handlebars expressions inside link text are preserved", async () => {
    const script = `
[[start]]:
[[Go to {{name}}]](other) or [Read "{{name}}"](a).

[a]:
A passage.

[[other]]:
Other section.
`;

    const warnings: string[] = [];
    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
        onWarning: (message) => warnings.push(message),
    });

    assertSuccess(result);
    const text = result.output.story.sections.start.text;
    expect(text).toContain('{{section "other" text="Go to {{name}}"}}');
    expect(text).toContain('{{passage "a" text="Read \\"{{name}}\\""}}');
    expect(warnings).toEqual([]);
});

test("Warning: @import and @ui files are ignored without externalFiles", async () => {
    const script = `@import my_script.js
@ui ui.js

Some content
`;

    const warnings: string[] = [];
    const result = await compile({
        scriptBaseFilename: "test.squiffy",
        script: script,
        onWarning: (message) => warnings.push(message),
    });

    expect(result.success).toBe(true);
    expect(warnings).toEqual([
        "WARNING: test.squiffy line 1: \"@import my_script.js\" was ignored, as other files can't be loaded here",
        "WARNING: test.squiffy line 2: \"@ui ui.js\" was ignored, as other files can't be loaded here",
    ]);
});

const inMemoryFiles = (files: Record<string, string>) => ({
    getMatchingFilenames: async (pattern: string) => Object.keys(files).filter(name => name == pattern),
    getContent: async (filename: string) => files[filename],
    getLocalFilename: (filename: string) => filename,
});

test("The story starts at the main file's first section, even after an @import", async () => {
    const result = await compile({
        scriptBaseFilename: "story.squiffy",
        script: `@title New Story
@import chapter2.squiffy

Start writing! [[chapter2]]
`,
        externalFiles: inMemoryFiles({ "chapter2.squiffy": "[[chapter2]]:\nhello\n" }),
    });

    assertSuccess(result);
    expect(result.output.story.start).toBe("_default");
    expect(Object.keys(result.output.story.sections)).toEqual(["chapter2", "_default"]);
});

test("The story starts at the main file's first named section, even after an @import", async () => {
    const result = await compile({
        scriptBaseFilename: "story.squiffy",
        script: `@import chapter2.squiffy

[[intro]]:
Go to [[chapter2]].
`,
        externalFiles: inMemoryFiles({ "chapter2.squiffy": "[[chapter2]]:\nhello\n" }),
    });

    assertSuccess(result);
    expect(result.output.story.start).toBe("intro");
});

test("A main file with only @imports starts at the first imported section", async () => {
    const result = await compile({
        scriptBaseFilename: "story.squiffy",
        script: "@import chapter2.squiffy\n",
        externalFiles: inMemoryFiles({ "chapter2.squiffy": "[[chapter2]]:\nhello\n" }),
    });

    assertSuccess(result);
    expect(result.output.story.start).toBe("chapter2");
});

test("Warning: a section or passage name used more than once", async () => {
    const warnings: string[] = [];
    const result = await compile({
        scriptBaseFilename: "story.squiffy",
        script: `[[a]]:
one
[p]:
first
[p]:
second

[[b]]:
[p]:
a different section's passage is fine
@import chapter2.squiffy

[[a]]:
two
`,
        externalFiles: inMemoryFiles({ "chapter2.squiffy": "[[b]]:\nfrom chapter 2\n" }),
        onWarning: (message) => warnings.push(message),
    });

    assertSuccess(result);
    expect(warnings).toEqual([
        "WARNING: story.squiffy line 5: There's already a passage called [p] in section 'a', at line 3. This one replaces it.",
        "WARNING: chapter2.squiffy line 1: There's already a section called [[b]], at story.squiffy line 8. This one replaces it.",
        "WARNING: story.squiffy line 13: There's already a section called [[a]], at line 1. This one replaces it.",
    ]);
    expect(result.diagnostics.map(d => d.code)).toEqual([
        "squiffy/duplicate-passage",
        "squiffy/duplicate-section",
        "squiffy/duplicate-section",
    ]);
    // The later definition still wins
    expect(result.output.story.sections["a"].text).toContain("two");
    // ...replacing the earlier section's passages too
    expect(result.output.story.sections["a"].passages).toBeUndefined();
    expect(result.output.story.sections["b"].text).toContain("from chapter 2");
});

test("No duplicate warning for the compiler's own section names", async () => {
    const warnings: string[] = [];
    const result = await compile({
        scriptBaseFilename: "story.squiffy",
        script: "---\nintro\n+++Next\nmore\n---\nend\n",
        onWarning: (message) => warnings.push(message),
    });
    assertSuccess(result);
    expect(warnings).toEqual([]);
});

test("Warning when a section is named like one the compiler names itself", async () => {
    const warnings: string[] = [];
    await compile({
        scriptBaseFilename: "story.squiffy",
        script: "[[_continue1]]:\nhi\n+++Next\nmore\n",
        onWarning: (message) => warnings.push(message),
    });
    expect(warnings).toEqual([
        "WARNING: story.squiffy line 3: There's already a section called [[_continue1]], at line 1. This one replaces it.",
    ]);
});

test("A story's squiffy.json id is in its output, for checking saved games against", async () => {
    const withId = await compile({ script: "Hello", projectId: "abc-123" });
    assertSuccess(withId);
    expect(withId.output.story.projectId).toBe("abc-123");
    expect(await withId.getJs()).toContain("story.projectId = \"abc-123\";");

    const without = await compile({ script: "Hello" });
    assertSuccess(without);
    expect(without.output.story.projectId).toBeUndefined();
    expect(await without.getJs()).not.toContain("projectId");
});

test("A story's squiffy.json panels are in its output (#14, #443)", async () => {
    const panels = [{ passage: "status", label: "Status", position: "side" as const }];
    const withPanels = await compile({ script: "Hello", panels });
    assertSuccess(withPanels);
    expect(withPanels.output.story.panels).toEqual(panels);
    const js = await withPanels.getJs();
    expect(js).toContain("story.panels = [");
    expect(js).toContain("\"passage\": \"status\"");

    const without = await compile({ script: "Hello", panels: [] });
    assertSuccess(without);
    expect(without.output.story.panels).toBeUndefined();
    expect(await without.getJs()).not.toContain("panels");
});

test("A story's squiffy.json settings are in its output (#452)", async () => {
    const settings = [{ name: "warnings", label: "Content warnings", type: "toggle" as const }];
    const withSettings = await compile({ script: "Hello", settings });
    assertSuccess(withSettings);
    expect(withSettings.output.story.settings).toEqual(settings);
    expect(await withSettings.getJs()).toContain("story.settings = [");

    const without = await compile({ script: "Hello", settings: [] });
    assertSuccess(without);
    expect(without.output.story.settings).toBeUndefined();
    expect(await without.getJs()).not.toContain("story.settings");
});

test("@repeat marks a passage, which doesn't count towards @last (#104)", async () => {
    const warnings: string[] = [];
    const result = await compile({
        scriptBaseFilename: "story.squiffy",
        script: `[[a]]:
@repeat
Look at the [guard], the [door] or the [window].

[guard]:
@repeat
Go away.

[door]:
It's locked.

[window]:
It's dark outside.

[@last]:
That's everything.
`,
        onWarning: (message) => warnings.push(message),
    });

    assertSuccess(result);
    const section = result.output.story.sections["a"];
    expect(section.passages!["guard"].repeat).toBe(true);
    expect(section.passages!["door"].repeat).toBeUndefined();
    expect(section.passageCount).toBe(2);
    expect(warnings).toEqual([
        "WARNING: story.squiffy line 2: @repeat only works in a passage, so this was ignored.",
    ]);
    expect(result.diagnostics.map(d => d.code)).toEqual(["squiffy/repeat-not-in-passage"]);
});

test("@music and @sound go in the output, and the files they and {{music}} and {{sound}} name are listed (#444)", async () => {
    const script = `[[start]]:
@music theme.mp3
@sound bell.mp3
Hello. {{sound "door.mp3"}} [knock]

[knock]:
@music stop
@sound knock.mp3
{{music 'other.ogg' fade=2}}Knock.

[[quiet]]:
Nothing to hear. {{sound}}`;
    const result = await compile({ scriptBaseFilename: "test.squiffy", script });

    assertSuccess(result);
    const { sections, audio } = result.output.story;
    expect(sections.start.music).toBe("theme.mp3");
    expect(sections.start.sounds).toEqual(["bell.mp3"]);
    expect(sections.start.passages!.knock.music).toBeNull();
    expect(sections.start.passages!.knock.sounds).toEqual(["knock.mp3"]);
    expect(sections.quiet).not.toHaveProperty("music");
    expect(sections.quiet).not.toHaveProperty("sounds");
    expect(audio).toEqual(["theme.mp3", "bell.mp3", "door.mp3", "knock.mp3", "other.ogg"]);
    const js = await result.getJs();
    expect(js).toContain("story.audio = [");
    expect(js).toContain('"music": null');
});

test("@class puts classes in the output, for a section or a passage (#449)", async () => {
    const script = `[[start]]:
@class night  forest
@class night
Hello. [look up]

[look up]:
@class stars
Stars.

[[plain]]:
Nothing.`;
    const result = await compile({ scriptBaseFilename: "test.squiffy", script });

    assertSuccess(result);
    const { sections } = result.output.story;
    expect(sections.start.classes).toEqual(["night", "forest"]);
    expect(sections.start.passages!["look up"].classes).toEqual(["stars"]);
    expect(sections.plain).not.toHaveProperty("classes");
    expect(sections.start.text).not.toContain("@class");
});

test("@transition puts how a section or passage appears in the output, with its time (#489)", async () => {
    const script = `[[]]:
@transition fade

[[start]]:
@transition slide-up 1.5s
Hello. [look up]

[look up]:
@transition zoom 400ms
Stars.

[a]:
@transition none
A.

[[plain]]:
Nothing.`;
    const result = await compile({ scriptBaseFilename: "test.squiffy", script });

    assertSuccess(result);
    const { sections } = result.output.story;
    expect(sections[""].transition).toBe("fade");
    expect(sections[""]).not.toHaveProperty("transitionTime");
    expect(sections.start).toMatchObject({ transition: "slide-up", transitionTime: 1500 });
    expect(sections.start.passages!["look up"]).toMatchObject({ transition: "zoom", transitionTime: 400 });
    expect(sections.start.passages!.a.transition).toBe("none");
    expect(sections.plain).not.toHaveProperty("transition");
    expect(sections.start.text).not.toContain("@transition");
});

test("@leave puts how the old text goes in the output, with its time", async () => {
    const script = `[[start]]:
Hello. [[cave]] [look]

[look]:
@clear
@leave zoom 300ms
Look.

[[cave]]:
@clear
@leave fade 2s
Dark.`;
    const result = await compile({ scriptBaseFilename: "test.squiffy", script });

    assertSuccess(result);
    const { sections } = result.output.story;
    expect(sections.cave).toMatchObject({ leave: "fade", leaveTime: 2000 });
    expect(sections.start.passages!.look).toMatchObject({ leave: "zoom", leaveTime: 300 });
    expect(sections.start).not.toHaveProperty("leave");
    expect(sections.cave.text).not.toContain("@leave");
});

test("@leave warns when nothing it's for clears the screen", async () => {
    const leaveWarnings = async (script: string) => (await analyse({ script })).diagnostics
        .filter(d => d.code == "squiffy/transition").map(d => d.range.start.line);

    // In a section, and a passage, with no @clear
    expect(await leaveWarnings(`[[start]]:
@leave fade
Hello. [p]

[p]:
@leave fade
P.`)).toEqual([1, 5]);
    // A section's is for its passages that clear, and the master section's for every section
    expect(await leaveWarnings(`[[]]:
@leave fade

[[start]]:
@leave fade
Hello. [p]

[p]:
@clear
P.`)).toEqual([]);
    // The master section clears every section
    expect(await leaveWarnings(`[[]]:
@clear

[[start]]:
@leave fade
Hello.`)).toEqual([]);
});

test("@transition warns about a name or time it can't use (#489)", async () => {
    const analysis = await analyse({ script: `[[start]]:
@transition fade soon
@transition .bad
Hello.` });
    const warnings = analysis.diagnostics.filter(d => d.code == "squiffy/transition");
    expect(warnings.map(d => d.range.start.line)).toEqual([1, 2]);
    expect(warnings[0].message).toContain("soon");
    expect(warnings[1].message).toContain(".bad");
});

test("@sound stop stops the sounds playing, and isn't a file to load", async () => {
    const script = `[[start]]:
@sound stop
@sound bell.mp3
Hello. {{stopsounds}}`;
    const result = await compile({ scriptBaseFilename: "test.squiffy", script });

    assertSuccess(result);
    const { sections, audio } = result.output.story;
    expect(sections.start.sounds).toEqual(["stop", "bell.mp3"]);
    expect(audio).toEqual(["bell.mp3"]);
});

test("A story with no sound has no audio list (#444)", async () => {
    const result = await compile({ scriptBaseFilename: "test.squiffy", script: "Hello." });
    assertSuccess(result);
    expect(result.output.story).not.toHaveProperty("audio");
});
