import { describe, expect, test } from "vitest";
import { EditorState, Transaction } from "@codemirror/state";
import { narrowed, narrowing, narrowRange, setNarrow } from "./narrow.js";

const doc = "[[a]]:\nOne.\nTwo.\n\n[p]:\nPassage.\n\n\n[[b]]:\nEnd.";

function stateOf(text: string, startLine: number, endLine: number, withHeader = false) {
    const state = EditorState.create({ doc: text, extensions: [narrowing()] });
    const range = narrowRange(state, startLine, endLine, withHeader)!;
    return state.update({ effects: setNarrow.of(range), selection: { anchor: range.from } }).state;
}

const shown = (state: EditorState) => {
    const range = narrowed(state)!;
    return state.sliceDoc(range.from, range.to);
};

const typed = (state: EditorState, from: number, insert: string, to = from) =>
    state.update({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, annotations: Transaction.userEvent.of("input.type") }).state;

describe("the part of a document that's shown", () => {
    test("a section's text and passages, without its header or the blank lines after it", () => {
        expect(shown(stateOf(doc, 0, 7))).toBe("One.\nTwo.\n\n[p]:\nPassage.");
        expect(shown(stateOf(doc, 8, 9))).toBe("End.");
    });

    test("with its header, for a section whose header is its text", () => {
        expect(shown(stateOf("[[a]]:\nOne.\n+++More\nTwo.\n\n[[b]]:", 2, 4, true))).toBe("+++More\nTwo.");
    });

    test("an empty section is the line after its header", () => {
        const state = stateOf("[[a]]:\n\n[[b]]:\nEnd.", 0, 1);
        expect(narrowed(state)).toEqual({ from: 7, to: 7 });
    });

    test("there's nowhere to write when the header ends the document", () => {
        const state = EditorState.create({ doc: "[[a]]:", extensions: [narrowing()] });
        expect(narrowRange(state, 0, 0, false)).toBeUndefined();
        expect(narrowRange(state, 0, 0, true)).toEqual({ from: 0, to: 6 });
    });
});

describe("editing what's shown", () => {
    test("typing at either end stays inside", () => {
        let state = stateOf(doc, 0, 7);
        const { from } = narrowed(state)!;
        state = typed(state, from, "Zero. ");
        state = typed(state, narrowed(state)!.to, " More.");
        expect(shown(state)).toBe("Zero. One.\nTwo.\n\n[p]:\nPassage. More.");
        expect(state.doc.toString()).toBe("[[a]]:\nZero. One.\nTwo.\n\n[p]:\nPassage. More.\n\n\n[[b]]:\nEnd.");
    });

    test("deleting past either end does nothing", () => {
        const state = stateOf(doc, 0, 7);
        const { from, to } = narrowed(state)!;
        const del = (a: number, b: number) => state.update({ changes: { from: a, to: b }, annotations: Transaction.userEvent.of("delete.backward") }).state;
        expect(del(from - 1, from).doc.toString()).toBe(doc);
        expect(del(to, to + 1).doc.toString()).toBe(doc);
        expect(del(from, from + 1).doc.toString()).toBe(doc.replace("One.", "ne."));
    });

    test("a blank line is kept before what comes next", () => {
        // An empty section, straight before the next header
        let state = stateOf("[[a]]:\n\n[[b]]:\nEnd.", 0, 1);
        state = typed(state, narrowed(state)!.from, "Hello");
        expect(state.doc.toString()).toBe("[[a]]:\nHello\n\n[[b]]:\nEnd.");
        expect(shown(state)).toBe("Hello");
        expect(state.selection.main.head).toBe(12);
        // And it stays one blank line as the author carries on
        state = typed(state, 12, "!");
        expect(state.doc.toString()).toBe("[[a]]:\nHello!\n\n[[b]]:\nEnd.");
    });

    test("the cursor can't leave, and Select All selects what's shown", () => {
        const state = stateOf(doc, 0, 7);
        const { from, to } = narrowed(state)!;
        expect(state.update({ selection: { anchor: 0 } }).state.selection.main.head).toBe(from);
        expect(state.update({ selection: { anchor: doc.length } }).state.selection.main.head).toBe(to);
        const all = state.update({ selection: { anchor: 0, head: doc.length } }).state.selection.main;
        expect([all.from, all.to]).toEqual([from, to]);
    });

    test("changes from elsewhere go through, and what's shown follows them", () => {
        let state = stateOf(doc, 0, 7);
        // A rename, as the language service's edits arrive
        state = state.update({ changes: { from: 2, to: 3, insert: "attic" }, annotations: Transaction.userEvent.of("input.complete") }).state;
        expect(state.doc.line(1).text).toBe("[[attic]]:");
        expect(shown(state)).toBe("One.\nTwo.\n\n[p]:\nPassage.");
        // And undoing something outside
        state = state.update({ changes: { from: state.doc.length, insert: "\nMore." }, annotations: Transaction.userEvent.of("undo") }).state;
        expect(state.doc.toString().endsWith("End.\nMore.")).toBe(true);
    });

    test("showing everything again", () => {
        const state = stateOf(doc, 0, 7).update({ effects: setNarrow.of(null) }).state;
        expect(narrowed(state)).toBeNull();
        expect(state.update({ selection: { anchor: 0 } }).state.selection.main.head).toBe(0);
    });
});
