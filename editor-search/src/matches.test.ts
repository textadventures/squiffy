import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";
import { findMatches, matchFrom, matchIndex } from "./matches.js";

const state = EditorState.create({ doc: "The cat sat.\nA Cat, a category.\ncat" });

describe("findMatches", () => {
    test("finds every match, in order", () => {
        const matches = findMatches(state, new SearchQuery({ search: "cat" }));
        expect(matches.list.map(m => m.from)).toEqual([4, 15, 22, 32]);
        expect(matches.capped).toBe(false);
    });

    test("follows the query's options", () => {
        expect(findMatches(state, new SearchQuery({ search: "cat", caseSensitive: true })).list).toHaveLength(3);
        expect(findMatches(state, new SearchQuery({ search: "cat", wholeWord: true })).list).toHaveLength(3);
        expect(findMatches(state, new SearchQuery({ search: "c[a-z]+", regexp: true })).list.map(m => m.to - m.from)).toEqual([3, 3, 8, 3]);
    });

    test("nothing for an empty or invalid query", () => {
        expect(findMatches(state, new SearchQuery({ search: "" })).list).toEqual([]);
        expect(findMatches(state, new SearchQuery({ search: "(", regexp: true })).list).toEqual([]);
    });

    test("stops at the limit", () => {
        const matches = findMatches(state, new SearchQuery({ search: "cat" }), 2);
        expect(matches.list).toHaveLength(2);
        expect(matches.capped).toBe(true);
        expect(findMatches(state, new SearchQuery({ search: "cat" }), 4).capped).toBe(false);
    });
});

describe("matchIndex and matchFrom", () => {
    const matches = findMatches(state, new SearchQuery({ search: "cat" }));

    test("which match a selection is", () => {
        expect(matchIndex(matches, 4, 7)).toBe(0);
        expect(matchIndex(matches, 32, 35)).toBe(3);
        expect(matchIndex(matches, 4, 8)).toBe(-1);
        expect(matchIndex(matches, 5, 7)).toBe(-1);
    });

    test("the next match from a position, going round", () => {
        expect(matchFrom(matches, 0)?.from).toBe(4);
        expect(matchFrom(matches, 15)?.from).toBe(15);
        expect(matchFrom(matches, 16)?.from).toBe(22);
        expect(matchFrom(matches, 33)?.from).toBe(4);
        expect(matchFrom({ list: [], capped: false }, 0)).toBeNull();
    });
});
