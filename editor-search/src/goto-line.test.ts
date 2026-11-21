import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { parseLineTarget } from "./goto-line.js";

// Ten lines of "line N", with the cursor on line 5
const doc = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
const base = EditorState.create({ doc });
const state = EditorState.create({ doc, selection: { anchor: base.doc.line(5).from } });
const at = (line: number, column = 1) => state.doc.line(line).from + column - 1;

describe("parseLineTarget", () => {
    test("a line, and a column", () => {
        expect(parseLineTarget(state, "3")).toBe(at(3));
        expect(parseLineTarget(state, " 3 ")).toBe(at(3));
        expect(parseLineTarget(state, "3:4")).toBe(at(3, 4));
    });

    test("relative to the cursor", () => {
        expect(parseLineTarget(state, "+2")).toBe(at(7));
        expect(parseLineTarget(state, "-4")).toBe(at(1));
    });

    test("a percentage of the document", () => {
        expect(parseLineTarget(state, "50%")).toBe(at(5));
        expect(parseLineTarget(state, "100%")).toBe(at(10));
        expect(parseLineTarget(state, "+20%")).toBe(at(7));
    });

    test("past the end goes to the end", () => {
        expect(parseLineTarget(state, "99")).toBe(at(10));
        expect(parseLineTarget(state, "0")).toBe(at(1));
        expect(parseLineTarget(state, "-99")).toBe(at(1));
        expect(parseLineTarget(state, "3:99")).toBe(state.doc.line(3).to);
        expect(parseLineTarget(state, "3:0")).toBe(at(3));
    });

    test("anything else isn't a line", () => {
        for (const input of ["", "abc", "3:", ":4", "+", "%", "3.5"]) expect(parseLineTarget(state, input)).toBeNull();
    });
});
