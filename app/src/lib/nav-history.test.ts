import { describe, expect, test } from "vitest";
import { ChangeSet, Text } from "@codemirror/state";
import { HISTORY_LIMIT, NavHistory } from "./nav-history.js";

const at = (file: string, offset: number) => ({ file, offset });

describe("NavHistory", () => {
    test("goes back and forward through the places jumped from", () => {
        const history = new NavHistory();
        expect(history.canGoBack).toBe(false);
        history.record(at("a", 1));
        history.record(at("b", 2));
        // Now at c:3
        expect(history.goBack(at("c", 3))).toEqual(at("b", 2));
        expect(history.goBack(at("b", 2))).toEqual(at("a", 1));
        expect(history.canGoBack).toBe(false);
        expect(history.goBack(at("a", 1))).toBeUndefined();
        expect(history.goForward(at("a", 1))).toEqual(at("b", 2));
        expect(history.goForward(at("b", 2))).toEqual(at("c", 3));
        expect(history.canGoForward).toBe(false);
    });

    test("a new jump forgets where Forward went", () => {
        const history = new NavHistory();
        history.record(at("a", 1));
        history.goBack(at("b", 2));
        expect(history.canGoForward).toBe(true);
        history.record(at("a", 1));
        expect(history.canGoForward).toBe(false);
        expect(history.goBack(at("c", 3))).toEqual(at("a", 1));
    });

    test("doesn't keep the same place twice in a row, or go back to where the author is", () => {
        const history = new NavHistory();
        history.record(at("a", 1));
        history.record(at("a", 1));
        history.record(at("b", 2));
        expect(history.goBack(at("b", 2))).toEqual(at("a", 1));
        expect(history.canGoBack).toBe(false);
    });

    test("doesn't record nowhere, but still forgets Forward", () => {
        const history = new NavHistory();
        history.record(at("a", 1));
        history.goBack(at("b", 2));
        history.record(null);
        expect(history.canGoForward).toBe(false);
        expect(history.canGoBack).toBe(false);
    });

    test("keeps only the latest places", () => {
        const history = new NavHistory();
        for (let i = 0; i <= HISTORY_LIMIT; i++) history.record(at("a", i));
        let count = 0;
        while (history.goBack(null)) count++;
        expect(count).toBe(HISTORY_LIMIT);
    });

    test("tells its owner when something changes", () => {
        let changes = 0;
        const history = new NavHistory(() => changes++);
        history.record(at("a", 1));
        history.goBack(null);
        expect(changes).toBe(2);
    });

    describe("mapChanges", () => {
        const doc = Text.of(["[[one]]:", "Text.", "[[two]]:", "More."]);
        const offsetOf = (line: number) => doc.line(line).from;

        test("moves places with text added above them", () => {
            const history = new NavHistory();
            history.record(at("f", offsetOf(3)));
            history.mapChanges("f", ChangeSet.of({ from: 0, insert: "Hello\n" }, doc.length), doc);
            expect(history.goBack(null)).toEqual(at("f", offsetOf(3) + 6));
        });

        test("leaves other files' places alone", () => {
            const history = new NavHistory();
            history.record(at("g", 9));
            history.mapChanges("f", ChangeSet.of({ from: 0, insert: "Hello\n" }, doc.length), doc);
            expect(history.goBack(null)).toEqual(at("g", 9));
        });

        test("forgets a place whose lines were deleted", () => {
            const history = new NavHistory();
            history.record(at("f", offsetOf(1) + 2));
            history.record(at("f", offsetOf(3) + 2));
            // Deletes the second section
            history.mapChanges("f", ChangeSet.of({ from: doc.line(2).to, to: doc.length }, doc.length), doc);
            expect(history.goBack(null)).toEqual(at("f", offsetOf(1) + 2));
            expect(history.canGoBack).toBe(false);
        });

        test("keeps a place in a name that was renamed", () => {
            const history = new NavHistory();
            history.record(at("f", offsetOf(3) + 3));
            history.mapChanges("f", ChangeSet.of({ from: offsetOf(3) + 2, to: offsetOf(3) + 5, insert: "second" }, doc.length), doc);
            expect(history.goBack(null)?.offset).toBe(offsetOf(3) + 2);
        });
    });

    test("follows a renamed file, and forgets a deleted one", () => {
        const history = new NavHistory();
        history.record(at("a", 1));
        history.record(at("b", 2));
        history.renameFile("a", "c");
        history.forgetFile("b");
        expect(history.goBack(null)).toEqual(at("c", 1));
    });
});
