// Checks that compile(), now built on parse, analyse and emit, gives exactly the same results as
// the Squiffy 6.0 compiler (frozen in testing/legacy-compiler.ts): the same output, the same
// errors and the same warnings, in the same order.
//
// To also check a folder of your own stories, set SQUIFFY_CORPUS_DIR, e.g.
//   SQUIFFY_CORPUS_DIR=~/stories npx vitest --run equivalence

import { beforeAll, describe, expect, test, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { glob } from "glob";

import { compile } from "./compiler.js";
import { compile as legacyCompile } from "./testing/legacy-compiler.js";

beforeAll(() => {
    vi.stubGlobal("crypto", {
        randomUUID: () => "00000000-0000-0000-0000-000000000000"
    });
});

interface ExternalFiles {
    getMatchingFilenames(pattern: string): Promise<string[]>;
    getContent(filename: string): Promise<string>;
    getLocalFilename(filename: string): string;
}

// Each compiler needs its own ExternalFiles, since the disk one tracks which files it has read.
type ExternalFilesFactory = () => ExternalFiles;

const diskFiles = (inputFilename: string): ExternalFilesFactory => () => {
    const includedFiles = [path.resolve(inputFilename)];
    const basePath = path.resolve(path.dirname(inputFilename));
    return {
        getMatchingFilenames: async (pattern: string) => {
            const result = await glob(path.join(basePath, pattern));
            return result.sort().filter(filename => !includedFiles.includes(filename));
        },
        getContent: async (filename: string) => {
            const resolvedPath = path.isAbsolute(filename) ? filename : path.join(basePath, filename);
            includedFiles.push(resolvedPath);
            return (await fs.readFile(resolvedPath)).toString();
        },
        getLocalFilename: (filename: string) => path.relative(basePath, filename),
    };
};

const memoryFiles = (files: Record<string, string>): ExternalFilesFactory => () => ({
    getMatchingFilenames: async (pattern: string) => {
        const regex = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
        return Object.keys(files).filter(name => regex.test(name));
    },
    getContent: async (filename: string) => files[filename] ?? "",
    getLocalFilename: (filename: string) => filename,
});

interface Settings {
    script: string;
    scriptBaseFilename?: string;
    externalFiles?: ExternalFilesFactory;
    globalJs?: boolean;
}

async function run(compiler: typeof compile | typeof legacyCompile, settings: Settings) {
    const warnings: string[] = [];
    let result;
    try {
        result = await compiler({
            script: settings.script,
            scriptBaseFilename: settings.scriptBaseFilename,
            externalFiles: settings.externalFiles?.(),
            globalJs: settings.globalJs,
            onWarning: message => warnings.push(message),
        });
    }
    catch (e) {
        return { threw: String(e), warnings };
    }
    if (!result.success) {
        return { success: false, errors: result.errors, warnings };
    }
    return {
        success: true,
        output: JSON.stringify(result.output),
        js: await result.getJs(),
        jsWithoutHeader: await result.getJs(true),
        uiInfo: result.getUiInfo(),
        warnings,
    };
}

async function expectSameResult(settings: Settings) {
    const expected = await run(legacyCompile, settings);
    const actual = await run(compile, settings);
    // The old compiler didn't warn about duplicate sections and passages (tested in compiler.test.ts)
    actual.warnings = actual.warnings.filter(w => !/There's already a (section|passage) called/.test(w));

    if ("threw" in expected) {
        // The old compiler crashed on some content before the first section of an imported
        // file. The new one reports an error instead (or, for text, ignores it as before).
        expect("threw" in actual, "the new compiler shouldn't throw").toBe(false);
        return;
    }
    if (settings.externalFiles && /^@import .*\.squiffy/m.test(settings.script)) {
        // The old compiler started the story at the first section of the first file it read, so
        // an @import above the main file's first section made the story start in the imported
        // file. The new one starts at the main file's first section (tested in compiler.test.ts).
        expect(ignoreStart(actual)).toEqual(ignoreStart(expected));
        return;
    }
    expect(actual).toEqual(expected);
}

function ignoreStart<T>(result: T): T {
    return JSON.parse(JSON.stringify(result)
        .replace(/story\.start = \\"[^"\\]*\\"/g, "story.start = <start>")
        .replace(/\\"start\\":\\"[^"\\]*\\"/g, "<start>"));
}

describe("story corpus", async () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const corpusDirs = [repoRoot];
    if (process.env.SQUIFFY_CORPUS_DIR) {
        corpusDirs.push(path.resolve(process.env.SQUIFFY_CORPUS_DIR.replace(/^~/, process.env.HOME ?? "~")));
    }

    const files: string[] = [];
    for (const dir of corpusDirs) {
        // syntaxes/samples holds the TextMate grammar's test files, which @import and @ui files that don't exist.
        // site/src/tutorial is the docs tutorial's story, which uses @end, which the old compiler doesn't have.
        files.push(...(await glob("**/*.squiffy", { cwd: dir, absolute: true, ignore: ["**/node_modules/**", "**/dist/**", "**/syntaxes/samples/**", "**/site/src/tutorial/**"] })).sort());
    }

    test("finds stories", () => {
        expect(files.length).toBeGreaterThan(20);
    });

    for (const file of files) {
        test(path.relative(repoRoot, file), async () => {
            const script = await fs.readFile(file, "utf8");
            await expectSameResult({ script, scriptBaseFilename: path.basename(file), externalFiles: diskFiles(file) });
            await expectSameResult({ script, scriptBaseFilename: path.basename(file), globalJs: true });
        });
    }
});

const edgeCases: Record<string, Settings> = {
    "no filename": { script: "[[a]]:\n[[missing]]\n[p]:\n[nope]" },
    "passage before section": { script: "[p]:\ntext", scriptBaseFilename: "s.squiffy" },
    "passage after preamble text": { script: "hello\n[p]:\nin passage\n[q]\n[nope]" },
    "separator before content": { script: "@title T\n---\nhello\n---\nsecond [[a>]]\n+++More\nthird [[b]](>, x=1)" },
    "separator in preamble twice": { script: "---\n---\ntext" },
    "next link with nothing after": { script: "[[only]]:\n[[go>]] and [[go2]](>)" },
    "duplicate sections and passages": { script: "[[a]]:\none\n[p]:\nx\n[p]:\ny\n[[b]]:\n[[a]]\n[[a]]:\ntwo [p]" },
    "ui block": { script: "@ui\n    var x = 1;\n\tvar y = 2;\n---\n[[s]]:\n    js();\ntext" },
    "ui block across a section": { script: "@ui\n[[s]]:\n    js();\nhello" },
    "text in ui block": { script: "@ui\n    ok();\nnot ok\n---\nafter" },
    "ui file": { script: "@ui ui.js\n@import *.js\n@import style.css\nhi", externalFiles: memoryFiles({ "ui.js": "ui();", "a.js": "", "b.js": "", "style.css": "" }) },
    "attributes": { script: "@set a\n@unset b\n@inc c\n@inc d 5\n@dec e\n@dec f 2\n[[s]]:\n@clear\n@set x=1\n[p]:\n@clear\n@inc y\n    js();\ntext\n    indented text\n@set late" },
    "js after text is text": { script: "[[s]]:\ntext\n    not js\n\n\tstill text" },
    "snippets": { script: "[[a]]:\nA\n[snippet: s1]:\n[p]:\n+++\n---\n@set x\n[[b]]:\nB\n[snippet: s2]:\nend" },
    "links and handlebars": { script: "[[s]]:\n{{#if x}}[a]{{/if}} [[t {{y}}]](s, z=1) [u](p) ![img](i.png) [web](https://x.y) [a][b] [c](d)\n{{embed \"p\"}} {{embed 'nope'}} {{~ embed \"s\"}}\n[p]:\n[[s]] [[n, with comma]] [q, x=1]\n[q]:\nq" },
    "links spanning lines": { script: "[[s]]:\n[[multi\nline]](s) [a\nb](c)\n[c]:\n" },
    "toString as a link target": { script: "[[s]]:\n[[toString]] [constructor] {{embed \"hasOwnProperty\"}}" },
    "crlf and stray carriage returns": { script: "[[a]]:\r\ntext [[b]]\r\n[[b]]:\r\nmore\r[x]\r\n" },
    "v5 syntax": { script: "[[s]]:\n{if x:yes}{else:no} {x} {@x+=1} {rotate:a,b}", scriptBaseFilename: "v5.squiffy" },
    "import order": {
        script: "before\n@import a.squiffy\nafter [[x]] [[y>]]\n[[main]]:\n@import b.squiffy\nmain text [[c]]",
        externalFiles: memoryFiles({
            "a.squiffy": "[[x]]:\nfrom a\n---\nauto [[y]]",
            "b.squiffy": "ignored text\n\n[[main]]:\nreplaced\n[[c]]:\nc",
        }),
    },
    "import with v5 syntax and error": {
        script: "[[s]]:\n{x}\n@import bad.squiffy\nnever",
        externalFiles: memoryFiles({ "bad.squiffy": "{y}\n[orphan]:\n" }),
    },
    "imported file with separator first": {
        script: "@import a.squiffy\n[[s]]:\nmain",
        externalFiles: memoryFiles({ "a.squiffy": "---\n[[a]]:\na\n---\nb" }),
    },
    "empty": { script: "" },
    "whitespace only": { script: "\n  \n\t\n" },
    "only a title": { script: "@title Hello\n@start nowhere" },
};

describe("edge cases", () => {
    for (const [name, settings] of Object.entries(edgeCases)) {
        test(name, async () => {
            await expectSameResult({ scriptBaseFilename: "test.squiffy", ...settings });
        });
    }
});

// Random stories built from fragments of Squiffy syntax, to find differences the cases above miss.
describe("fuzz", () => {
    const fragments = [
        "", "", "", "text", "more text", "  ", "\t", "---", "+++", "+++Onward", "@ui", "@ui ui.js",
        "@clear", "@title T", "@start b", "@set x=1", "@unset y", "@inc z", "@dec z 2",
        "    js();", "\tjs2();", "[[a]]:", "[[b]]:", "[[a b]]:", "[p]:", "[q]:", "[snippet: s]:",
        "@import inc.squiffy", "@import *.js",
        "[[a]]", "[[b]] and [[c]]", "[p] [q] [r]", "[[go]](a, x=1)", "[go](p)", "[[next>]]", "[[n]](>)",
        "[[n]](>, x=1)", "{{embed \"p\"}}", "{{embed 'zz'}}", "{{#if x}}[p]{{/if}}", "{{a.[1]}} [[{{b}}]]",
        "![i](p)", "[x](https://y)", "[a][b]", "[[a\\\"b]]", "{x}", "{if x:y}",
    ];
    const includedFragments = ["", "text", "[[c]]:", "[p]:", "---", "+++", "    js();", "@set q", "[[a]]", "[p]", "@clear"];

    // A small seeded PRNG, so failures are reproducible
    const random = (seed: number) => () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };

    const build = (rand: () => number, pool: string[], maxLines: number) => {
        const count = Math.floor(rand() * maxLines);
        const lines: string[] = [];
        for (let i = 0; i < count; i++) {
            lines.push(pool[Math.floor(rand() * pool.length)]);
        }
        return lines.join(rand() < 0.1 ? "\r\n" : "\n");
    };

    for (let batch = 0; batch < 10; batch++) {
        test(`batch ${batch}`, async () => {
            for (let i = 0; i < 200; i++) {
                const seed = batch * 1000 + i;
                const rand = random(seed + 1);
                const script = build(rand, fragments, 25);
                const settings: Settings = {
                    script,
                    scriptBaseFilename: "fuzz.squiffy",
                    globalJs: rand() < 0.5,
                };
                if (rand() < 0.7) {
                    settings.externalFiles = memoryFiles({
                        "inc.squiffy": build(rand, includedFragments, 10),
                        "ui.js": "ui();",
                        "x.js": "",
                    });
                }
                try {
                    await expectSameResult(settings);
                }
                catch (e) {
                    throw new Error(`Seed ${seed} failed for script:\n${JSON.stringify(script)}\n${e}`, { cause: e });
                }
            }
        });
    }
});
