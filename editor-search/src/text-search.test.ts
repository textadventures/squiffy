import { describe, expect, test } from "vitest";
import { isValidSearch, searchText } from "./text-search.js";

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
