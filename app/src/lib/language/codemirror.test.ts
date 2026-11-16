import { describe, expect, test } from "vitest";
import { Text } from "@codemirror/state";
import { toOffset, toPosition } from "./codemirror.js";

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
