import { beforeAll, describe, expect, test, vi } from "vitest";

import { compile } from "./compiler.js";
import {
    formatProjectFile, getStoryFiles, isExcluded, parseProjectFile, ProjectFile, updateProjectFile,
} from "./project.js";

beforeAll(() => {
    vi.stubGlobal("crypto", {
        randomUUID: () => "00000000-0000-0000-0000-000000000000"
    });
});

const project = (main: string, exclude: string[] = []): ProjectFile => ({ version: 1, main, exclude });

describe("parseProjectFile", () => {
    test("a valid file", () => {
        expect(parseProjectFile("{ \"version\": 1, \"main\": \"story.squiffy\", \"exclude\": [\"drafts/**\"] }")).toEqual({
            success: true, project: { version: 1, main: "story.squiffy", exclude: ["drafts/**"] },
        });
    });

    test("backButton is kept when it's given", () => {
        expect(parseProjectFile("{ \"version\": 1, \"main\": \"a.squiffy\", \"backButton\": false }")).toEqual({
            success: true, project: { version: 1, main: "a.squiffy", exclude: [], backButton: false },
        });
    });

    test("strings are kept, leaving out any Squiffy doesn't know", () => {
        const text = JSON.stringify({ version: 1, main: "a.squiffy", strings: { restart: "Recommencer", future: "x", toString: "y" } });
        expect(parseProjectFile(text)).toEqual({
            success: true, project: { version: 1, main: "a.squiffy", exclude: [], strings: { restart: "Recommencer" } },
        });
    });

    test("exclude is optional, other properties are ignored, and main is normalised", () => {
        expect(parseProjectFile("{ \"$schema\": \"x\", \"version\": 1, \"main\": \"./src\\\\story.squiffy\" }")).toEqual({
            success: true, project: { version: 1, main: "src/story.squiffy", exclude: [] },
        });
    });

    test.each([
        ["not json", "{", "squiffy.json isn't valid JSON"],
        ["not an object", "[]", "should contain an object"],
        ["no version", "{ \"main\": \"a.squiffy\" }", "needs a \"version\""],
        ["a bad version", "{ \"version\": \"1\", \"main\": \"a.squiffy\" }", "should be a whole number"],
        ["no main", "{ \"version\": 1 }", "needs a \"main\" file"],
        ["main outside the folder", "{ \"version\": 1, \"main\": \"../a.squiffy\" }", "a path inside the project's folder"],
        ["main not a .squiffy file", "{ \"version\": 1, \"main\": \"a.txt\" }", "should be a .squiffy file"],
        ["exclude not a list", "{ \"version\": 1, \"main\": \"a.squiffy\", \"exclude\": \"x\" }", "should be a list"],
        ["backButton not true or false", "{ \"version\": 1, \"main\": \"a.squiffy\", \"backButton\": \"no\" }", "should be true or false"],
        ["strings not an object", "{ \"version\": 1, \"main\": \"a.squiffy\", \"strings\": [] }", "should be an object of text"],
        ["a string that isn't text", "{ \"version\": 1, \"main\": \"a.squiffy\", \"strings\": { \"back\": 1 } }", "should be an object of text"],
    ])("refuses %s", (_, text, error) => {
        const result = parseProjectFile(text);
        expect(result.success).toBe(false);
        expect(!result.success && result.error).toContain(error);
    });

    test("refuses a newer version, saying a newer Squiffy is needed", () => {
        expect(parseProjectFile("{ \"version\": 2, \"main\": \"a.squiffy\" }")).toEqual({
            success: false, error: "This story's squiffy.json is version 2, which needs a newer version of Squiffy.",
        });
    });
});

describe("story map positions", () => {
    test("anything that isn't a position is left out, rather than being an error", () => {
        const parsed = parseProjectFile(JSON.stringify({
            version: 1, main: "a.squiffy",
            map: { sections: { a: [1, 2], b: "here", c: [1], d: [1, "2"] }, passages: { a: { p: [3, 4], q: null }, b: [1, 2] } },
        }));
        expect(parsed.success && parsed.project.map).toEqual({ sections: { a: [1, 2] }, passages: { a: { p: [3, 4] } } });
        const notAMap = parseProjectFile(JSON.stringify({ version: 1, main: "a.squiffy", map: "no" }));
        expect(notAMap.success && notAMap.project.map).toBeUndefined();
    });
});

describe("getStoryFiles", () => {
    test("every other .squiffy file, sorted by path, skipping node_modules and dot-folders", () => {
        const paths = [
            "story.squiffy", "b.squiffy", "a/z.squiffy", "B.squiffy", "notes.txt", "script.js",
            "node_modules/x/y.squiffy", ".git/a.squiffy", "sub/.hidden/c.squiffy", ".dot.squiffy",
        ];
        expect(getStoryFiles(project("story.squiffy"), paths)).toEqual({
            main: "story.squiffy",
            included: [".dot.squiffy", "B.squiffy", "a/z.squiffy", "b.squiffy"],
            excluded: [],
        });
    });

    test("exclude patterns, matching a file or a folder it's in", () => {
        const paths = ["story.squiffy", "drafts/a.squiffy", "drafts/old/b.squiffy", "_scratch.squiffy", "ch/_x.squiffy", "old/c.squiffy", "keep.squiffy"];
        const result = getStoryFiles(project("story.squiffy", ["drafts/**", "_*.squiffy", "old"]), paths);
        expect(result.included).toEqual(["ch/_x.squiffy", "keep.squiffy"]);
        expect(result.excluded).toEqual(["_scratch.squiffy", "drafts/a.squiffy", "drafts/old/b.squiffy", "old/c.squiffy"]);
    });

    test("extra folders to skip", () => {
        expect(getStoryFiles(project("s.squiffy"), ["s.squiffy", "out/a.squiffy", "b.squiffy"], ["out"]).included).toEqual(["b.squiffy"]);
    });

    test("isExcluded with ** in the middle", () => {
        expect(isExcluded("a/b/c/test.squiffy", ["a/**/test.squiffy"])).toBe(true);
        expect(isExcluded("a/test.squiffy", ["a/**/test.squiffy"])).toBe(true);
        expect(isExcluded("b/test.squiffy", ["a/**/test.squiffy"])).toBe(false);
    });
});

describe("writing project files", () => {
    test("a new file", () => {
        expect(JSON.parse(formatProjectFile({ main: "story.squiffy", exclude: ["x.squiffy"] }))).toEqual({
            $schema: "https://squiffystory.com/schema/squiffy.json", version: 1, main: "story.squiffy", exclude: ["x.squiffy"],
        });
        expect(JSON.parse(formatProjectFile({ main: "story.squiffy" })).exclude).toBeUndefined();
    });

    test("updates keep other properties and the indentation", () => {
        const text = "{\n    \"version\": 1,\n    \"main\": \"a.squiffy\",\n    \"custom\": true\n}\n";
        expect(updateProjectFile(text, { main: "b.squiffy", exclude: ["c.squiffy"] }))
            .toBe("{\n    \"version\": 1,\n    \"main\": \"b.squiffy\",\n    \"custom\": true,\n    \"exclude\": [\n        \"c.squiffy\"\n    ]\n}\n");
        expect(JSON.parse(updateProjectFile("{ \"version\": 1, \"main\": \"a.squiffy\", \"exclude\": [\"x\"] }", { exclude: [] })!))
            .toEqual({ version: 1, main: "a.squiffy" });
        expect(updateProjectFile("{", { main: "x" })).toBeUndefined();
    });

    test("story map positions, one to a line, and removed when there are none", () => {
        const text = "{\n  \"version\": 1,\n  \"main\": \"a.squiffy\"\n}\n";
        const updated = updateProjectFile(text, { map: { sections: { Cave: [120, -40] }, passages: { Cave: { look: [130, 0] }, Empty: {} } } })!;
        expect(updated).toBe("{\n  \"version\": 1,\n  \"main\": \"a.squiffy\",\n  \"map\": {\n    \"sections\": {\n      \"Cave\": [120, -40]\n    },\n    \"passages\": {\n      \"Cave\": {\n        \"look\": [130, 0]\n      }\n    }\n  }\n}\n");
        expect(parseProjectFile(updated)).toEqual({
            success: true,
            project: { version: 1, main: "a.squiffy", exclude: [], map: { sections: { Cave: [120, -40] }, passages: { Cave: { look: [130, 0] } } } },
        });
        expect(updateProjectFile(updated, { map: { sections: {}, passages: {} } })).toBe(text);
        expect(updateProjectFile(text, { map: { sections: { a: [1, 2] }, passages: {} } }))
            .toBe("{\n  \"version\": 1,\n  \"main\": \"a.squiffy\",\n  \"map\": {\n    \"sections\": {\n      \"a\": [1, 2]\n    }\n  }\n}\n");
    });
});

// Like the CLI: getMatchingFilenames leaves out files already included, and getContent records them
const folder = (files: Record<string, string>, main: string) => {
    const included = new Set([main]);
    return {
        getMatchingFilenames: async (pattern: string) => {
            const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, "[^/]*") + "$");
            return Object.keys(files).filter(name => regex.test(name) && !included.has(name)).sort();
        },
        getContent: async (filename: string) => {
            included.add(filename);
            return files[filename];
        },
        getLocalFilename: (filename: string) => filename,
    };
};

const compileFolder = async (files: Record<string, string>, main = "story.squiffy", warnings: string[] = []) => {
    const story = getStoryFiles(project(main), Object.keys(files));
    return compile({
        scriptBaseFilename: main,
        script: files[main],
        externalFiles: folder(files, main),
        storyFiles: story.included,
        onWarning: warning => warnings.push(warning),
    });
};

describe("folder mode", () => {
    test("the main file first, then the rest by path, without @imports", async () => {
        const result = await compileFolder({
            "story.squiffy": "@title Folder\n[[start]]:\nGo to [[b]] or [[a]].\n+++More\nmore",
            "b.squiffy": "[[b]]:\nB\n+++Next\nnext",
            "a.squiffy": "[[a]]:\nA",
        });
        if (!result.success) throw new Error(result.errors.join("\n"));
        expect(result.output.story.start).toBe("start");
        expect(result.getUiInfo().title).toBe("Folder");
        expect(Object.keys(result.output.story.sections)).toEqual(["start", "_continue1", "a", "b", "_continue2"]);
        expect(result.diagnostics).toEqual([]);
    });

    test("an @import in the main file still runs where it's written, and nothing is processed twice", async () => {
        const result = await compileFolder({
            "story.squiffy": "[[start]]:\nhi\n@import c.squiffy\n\n[[end]]:\nbye",
            "a.squiffy": "[[a]]:\nA",
            "c.squiffy": "[[c]]:\nC",
        });
        if (!result.success) throw new Error(result.errors.join("\n"));
        expect(Object.keys(result.output.story.sections)).toEqual(["start", "c", "end", "a"]);
        expect(result.diagnostics.map(d => [d.code, d.severity, d.file, d.range.start.line])).toEqual([
            ["squiffy/redundant-import", "hint", "story.squiffy", 2],
        ]);
    });

    test("hints aren't passed to onWarning", async () => {
        const warnings: string[] = [];
        await compileFolder({ "story.squiffy": "@import a.squiffy\n[[s]]:\n", "a.squiffy": "[[a]]:\n" }, "story.squiffy", warnings);
        expect(warnings).toEqual([]);
    });

    test("no hint for an @import of an excluded file, or one that also brings in a script", async () => {
        const files = {
            "story.squiffy": "@import drafts/x.squiffy\n@import *.*\n[[s]]:\n",
            "drafts/x.squiffy": "[[x]]:\n",
            "a.squiffy": "[[a]]:\n",
            "a.js": "",
        };
        const story = getStoryFiles(project("story.squiffy", ["drafts/**"]), Object.keys(files));
        const result = await compile({
            scriptBaseFilename: "story.squiffy", script: files["story.squiffy"],
            externalFiles: folder(files, "story.squiffy"), storyFiles: story.included,
        });
        if (!result.success) throw new Error(result.errors.join("\n"));
        expect(result.diagnostics).toEqual([]);
        expect(Object.keys(result.output.story.sections)).toEqual(["x", "a", "s"]);
    });

    test("@title and @start outside the main file are ignored, with a warning", async () => {
        const warnings: string[] = [];
        const result = await compileFolder({
            "story.squiffy": "@title Main\n[[start]]:\n[[other]]",
            "other.squiffy": "@title Other\n@start other\n[[other]]:\n",
        }, "story.squiffy", warnings);
        if (!result.success) throw new Error(result.errors.join("\n"));
        expect(result.getUiInfo().title).toBe("Main");
        expect(result.output.story.start).toBe("start");
        expect(warnings).toEqual([
            "WARNING: other.squiffy line 1: @title only works in the story's main file, so this was ignored.",
            "WARNING: other.squiffy line 2: @start only works in the story's main file, so this was ignored.",
        ]);
    });

    test("@title in an @imported file still works outside folder mode", async () => {
        const files = { "story.squiffy": "@import other.squiffy\n[[s]]:\n", "other.squiffy": "@title Other\n" };
        const result = await compile({ scriptBaseFilename: "story.squiffy", script: files["story.squiffy"], externalFiles: folder(files, "story.squiffy") });
        if (!result.success) throw new Error(result.errors.join("\n"));
        expect(result.getUiInfo().title).toBe("Other");
    });

    test("an error in another file stops the build", async () => {
        const result = await compileFolder({ "story.squiffy": "[[s]]:\n", "b.squiffy": "[p]:\norphan" });
        expect(result.success).toBe(false);
        expect(!result.success && result.errors).toEqual([
            "ERROR: b.squiffy line 1: Can't add passage \"p\" as no section has been created.",
        ]);
    });
});
