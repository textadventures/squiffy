import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { findMatch } from "./search-highlight.js";

describe("search highlight (#679)", () => {
    const state = EditorState.create({ doc: "[[start]]:\nYou meet Heather.\n\n[[end]]:\nHEATHER waves." });

    test("finds the first match, ignoring case and the space around the search", () => {
        expect(findMatch(state, " heather ")).toEqual({ from: 20, to: 27 });
        expect(state.sliceDoc(20, 27)).toBe("Heather");
    });

    test("only within a range, such as the section that's open", () => {
        const end = state.doc.toString().indexOf("[[end]]");
        expect(findMatch(state, "heather", end)).toEqual({ from: end + 9, to: end + 16 });
        expect(findMatch(state, "heather", 0, 10)).toBeNull();
    });

    test("nothing for an empty search, or one that isn't there", () => {
        expect(findMatch(state, "  ")).toBeNull();
        expect(findMatch(state, "dragon")).toBeNull();
    });
});
