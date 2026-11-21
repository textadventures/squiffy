import { describe, expect, test } from "vitest";
import { isValidSearch, replaceInText, searchText } from "./text-search.js";

const text = "The cat sat.\r\nA Cat, a category.\ncat";

describe("searchText", () => {
    test("where each match is, by line and column", () => {
        expect(searchText(text, { search: "cat" })).toEqual([
            { line: 0, column: 4, endLine: 0, endColumn: 7, lineText: "The cat sat." },
            { line: 1, column: 2, endLine: 1, endColumn: 5, lineText: "A Cat, a category." },
            { line: 1, column: 9, endLine: 1, endColumn: 12, lineText: "A Cat, a category." },
            { line: 2, column: 0, endLine: 2, endColumn: 3, lineText: "cat" },
        ]);
    });

    test("follows the options", () => {
        expect(searchText(text, { search: "cat", caseSensitive: true })).toHaveLength(3);
        expect(searchText(text, { search: "cat", wholeWord: true })).toHaveLength(3);
        expect(searchText(text, { search: "c[a-z]+", regexp: true }).map(m => m.endColumn - m.column)).toEqual([3, 3, 8, 3]);
    });

    test("a match over more than one line", () => {
        expect(searchText(text, { search: "sat\\.\\nA", regexp: true })).toEqual([
            { line: 0, column: 8, endLine: 1, endColumn: 1, lineText: "The cat sat." },
        ]);
    });

    test("stops at the limit", () => {
        expect(searchText(text, { search: "cat" }, 2)).toHaveLength(2);
    });

    test("nothing for an empty or invalid search", () => {
        expect(searchText(text, { search: "" })).toEqual([]);
        expect(searchText(text, { search: "(", regexp: true })).toEqual([]);
        expect(isValidSearch({ search: "(", regexp: true })).toBe(false);
        expect(isValidSearch({ search: "(" })).toBe(true);
    });
});

describe("replaceInText", () => {
    test("replaces every match, keeping the line breaks", () => {
        expect(replaceInText(text, { search: "cat" }, "dog")).toEqual({ text: "The dog sat.\r\nA dog, a dogegory.\r\ndog", count: 4 });
        expect(replaceInText("a cat\na cat", { search: "cat", wholeWord: true }, "dog").text).toBe("a dog\na dog");
    });

    test("nothing to replace", () => {
        expect(replaceInText(text, { search: "dog" }, "cat")).toEqual({ text, count: 0 });
        expect(replaceInText(text, { search: "(", regexp: true }, "cat").count).toBe(0);
    });

    test("groups of a regular expression", () => {
        expect(replaceInText("one two", { search: "(\\w+) (\\w+)", regexp: true }, "$2 $1!").text).toBe("two one!");
        expect(replaceInText("one", { search: "o(n)e", regexp: true }, "[$&] $$1 $9 $1x").text).toBe("[one] $1 $9 nx");
        // Not a regular expression: the dollar signs are kept
        expect(replaceInText("one", { search: "one" }, "$1 $&").text).toBe("$1 $&");
    });

    test("escapes in the replacement", () => {
        expect(replaceInText("a,b", { search: "," }, "\\n").text).toBe("a\nb");
        expect(replaceInText("a,b", { search: "," }, "\\\\t").text).toBe("a\\tb");
    });

    test("only one match", () => {
        expect(replaceInText(text, { search: "cat" }, "dog", { line: 1, column: 9 })).toEqual({ text: "The cat sat.\r\nA Cat, a dogegory.\r\ncat", count: 1 });
        // The text there has changed since the search
        expect(replaceInText(text, { search: "cat" }, "dog", { line: 1, column: 8 }).count).toBe(0);
        expect(replaceInText(text, { search: "cat" }, "dog", { line: 9, column: 0 }).count).toBe(0);
    });
});
