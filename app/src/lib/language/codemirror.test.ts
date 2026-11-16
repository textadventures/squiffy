import { describe, expect, test } from "vitest";
import { Text } from "@codemirror/state";
import { applyEditsToString, toOffset, toPosition } from "./codemirror.js";

describe("positions", () => {
    const doc = Text.of(["[[start]]:", "Hello", ""]);

    test("maps language service positions to offsets and back", () => {
        expect(toOffset(doc, { line: 1, character: 2 })).toBe(13);
        expect(toPosition(doc, 13)).toEqual({ line: 1, character: 2 });
    });

    test("clamps positions past the end of a line or the document", () => {
        expect(toOffset(doc, { line: 1, character: 99 })).toBe(16);
        expect(toOffset(doc, { line: 10, character: 0 })).toBe(doc.length);
    });
});

describe("applyEditsToString", () => {
    const range = (line: number, start: number, end: number) => ({ start: { line, character: start }, end: { line, character: end } });

    test("applies several edits, wherever they are", () => {
        const text = "[[a]]:\nGo to [[b]].\n\n[[b]]:\nEnd.";
        const edits = [
            { range: range(1, 8, 9), newText: "next" },
            { range: range(3, 2, 3), newText: "next" },
        ];
        expect(applyEditsToString(text, edits)).toBe("[[a]]:\nGo to [[next]].\n\n[[next]]:\nEnd.");
    });

    test("keeps Windows line endings", () => {
        expect(applyEditsToString("[[a]]:\r\nx\r\n", [{ range: range(1, 0, 1), newText: "y\nz" }]))
            .toBe("[[a]]:\r\ny\r\nz\r\n");
    });
});
