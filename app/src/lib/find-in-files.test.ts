import { describe, expect, test } from "vitest";
import { excerpt, findInFiles, isSearchable, summary } from "./find-in-files.js";

const files: Record<string, string> = {
    "story.squiffy": "The cat sat.\nA cat.",
    "style.css": "body { color: red; }",
    "notes.txt": "cat\ncat\ncat",
};
const read = async (path: string) => files[path];
const paths = Object.keys(files);

describe("findInFiles", () => {
    test("matches by file, leaving out files with none", async () => {
        const results = await findInFiles(paths, read, { search: "cat" });
        expect(results.files.map(f => [f.file, f.matches.length])).toEqual([["story.squiffy", 2], ["notes.txt", 3]]);
        expect(results.total).toBe(5);
        expect(results.capped).toBe(false);
        expect(summary(results)).toBe("5 results in 2 files");
    });

    test("stops at the limit, saying there are more", async () => {
        const results = await findInFiles(paths, read, { search: "cat" }, 3);
        expect(results.files.map(f => [f.file, f.matches.length])).toEqual([["story.squiffy", 2], ["notes.txt", 1]]);
        expect(results.capped).toBe(true);
        expect(summary(results)).toBe("3+ results in 2 files");

        expect((await findInFiles(paths, read, { search: "cat" }, 5)).capped).toBe(false);
        const two = await findInFiles(paths, read, { search: "cat" }, 2);
        expect(two.files.map(f => f.file)).toEqual(["story.squiffy"]);
        expect(two.capped).toBe(true);
    });

    test("skips a file that can't be read", async () => {
        const results = await findInFiles([...paths, "gone.txt"], read, { search: "red" });
        expect(results.files.map(f => f.file)).toEqual(["style.css"]);
        expect(summary(results)).toBe("1 result in 1 file");
    });

    test("no results", async () => {
        expect(summary(await findInFiles(paths, read, { search: "dog" }))).toBe("No results");
    });
});

describe("isSearchable", () => {
    test("text files outside the build folder", () => {
        expect(isSearchable("story.squiffy")).toBe(true);
        expect(isSearchable("chapters/two.squiffy")).toBe(true);
        expect(isSearchable("squiffy.json")).toBe(true);
        expect(isSearchable("cover.png")).toBe(false);
        expect(isSearchable("build/story.js")).toBe(false);
    });
});

describe("excerpt", () => {
    const match = (lineText: string, column: number, endColumn: number, endLine = 0) => ({ line: 0, column, endLine, endColumn, lineText });

    test("splits the line round the match, without its indentation", () => {
        expect(excerpt(match("    The cat sat.", 8, 11))).toEqual({ before: "The ", match: "cat", after: " sat." });
    });

    test("shortens a long line", () => {
        const e = excerpt(match("a".repeat(100) + "cat" + "b".repeat(300), 100, 103));
        expect(e.before).toBe("…" + "a".repeat(40));
        expect(e.after).toBe("b".repeat(200) + "…");
    });

    test("a match that carries on to the next line", () => {
        expect(excerpt(match("The cat sat.", 8, 1, 1))).toEqual({ before: "The cat ", match: "sat.", after: "" });
    });
});
