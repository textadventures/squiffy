import { describe, expect, test } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { DocumentSymbol } from "squiffy-compiler/language-service";
import { addSectionOrPassageSpec, insertSnippetSpec, userSnippets } from "./editor-commands.js";

const range = (start: number, end: number) => ({ start: { line: start, character: 0 }, end: { line: end, character: 0 } });
const symbol = (name: string, kind: DocumentSymbol["kind"], start: number, end: number): DocumentSymbol =>
    ({ name, kind, range: range(start, end), selectionRange: range(start, start), children: [] });

// Applies a command's transaction and returns the text, with | where the cursor ends up
function run(doc: string, from: number, to: number, kind: "section" | "passage", symbols: DocumentSymbol[]) {
    const state = EditorState.create({ doc, selection: EditorSelection.range(from, to) });
    const after = state.update(addSectionOrPassageSpec(state, kind, symbols)).state;
    const head = after.selection.main.head;
    return after.doc.sliceString(0, head) + "|" + after.doc.sliceString(head);
}

// Inserts a snippet with | as the cursor, and returns the text with | where the cursor ends up
function snippet(doc: string, content: string) {
    const at = doc.indexOf("|");
    const state = EditorState.create({ doc: doc.replace("|", ""), selection: EditorSelection.cursor(at) });
    const after = state.update(insertSnippetSpec(state, content)).state;
    const head = after.selection.main.head;
    return after.doc.sliceString(0, head) + "|" + after.doc.sliceString(head);
}

describe("Snippets", () => {
    test("go where the cursor is", () => {
        expect(snippet("You see |.", "{{embed \"name\"}}")).toBe("You see {{embed \"name\"}}|.");
    });

    test("that start with @ go on the cursor's line when it's blank", () => {
        expect(snippet("[[a]]:\n|\nText.", "@set attribute")).toBe("[[a]]:\n@set attribute|\nText.");
    });

    test("that start with @ go on a line after the cursor's, when there's text before the cursor", () => {
        expect(snippet("[[a]]:\nYou take| the key.", "@set attribute")).toBe("[[a]]:\nYou take the key.\n@set attribute|");
    });

    test("that start with @ go on a line before the cursor's, when the cursor is at its start", () => {
        expect(snippet("[[a]]:\n|You take the key.", "@set attribute")).toBe("[[a]]:\n@set attribute|\nYou take the key.");
    });

    test("that start with @ go after a header, not before it", () => {
        expect(snippet("|[[a]]:\nText.", "@inc score")).toBe("[[a]]:\n@inc score|\nText.");
    });
});

describe("Add section and Add passage", () => {
    const doc = "[[a]]:\nGo to cave.\n\n[[b]]:\nEnd.";
    const symbols = [symbol("a", "section", 0, 2), symbol("b", "section", 3, 4)];

    test("turn the selection into a link, and add its header after the section the cursor's in", () => {
        expect(run(doc, 13, 17, "section", symbols)).toBe("[[a]]:\nGo to [[cave]].\n\n[[cave]]:\n|\n\n[[b]]:\nEnd.");
    });

    test("add an empty header with the cursor between its brackets, without a selection", () => {
        expect(run(doc, 30, 30, "passage", symbols)).toBe("[[a]]:\nGo to cave.\n\n[[b]]:\nEnd.\n\n[|]:\n");
    });
});

describe("user snippets", () => {
    test("take each snippet's text from under its header", () => {
        const text = "[snippet:greet]:\nHello!\n\n[[start]]:\nHi.";
        expect(userSnippets([symbol("greet", "snippet", 0, 2), symbol("start", "section", 3, 4)], text))
            .toEqual([{ name: "greet", content: "Hello!" }]);
    });
});
