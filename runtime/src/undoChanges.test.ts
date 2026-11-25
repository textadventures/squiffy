import { expect, test } from "vitest";
import { applyUndoChange, undoEntry } from "./undoChanges.js";

const undo = (oldValue: unknown, newValue: unknown) => {
    const entry = undoEntry({ a: oldValue }, () => newValue);
    return { entry, back: "a" in entry.changes ? applyUndoChange(structuredClone(newValue), entry.changes.a) : entry.values.a };
};

test("an object keeps only the keys that changed, and goes back to its old value", () => {
    const { entry, back } = undo({ start: 1, cave: 2, gone: 1 }, { start: 1, cave: 3, lake: 1 });
    expect(entry).toEqual({ values: {}, changes: { a: { set: { cave: 2, gone: 1 }, remove: ["lake"] } } });
    expect(back).toEqual({ start: 1, cave: 2, gone: 1 });
});

test("an object that's the same keeps nothing", () => {
    expect(undo({ hp: { now: 3 } }, { hp: { now: 3 } }).entry).toEqual({ values: {}, changes: { a: {} } });
});

test("a list that was added to keeps its old length", () => {
    const { entry, back } = undo(["start", { x: 1 }], ["start", { x: 1 }, "cave"]);
    expect(entry.changes.a).toEqual({ length: 2 });
    expect(back).toEqual(["start", { x: 1 }]);
});

test("a list that changed in another way keeps its old value", () => {
    expect(undo(["start", "cave"], ["cave"]).entry).toEqual({ values: { a: ["start", "cave"] }, changes: {} });
    expect(undo(["start", "cave"], ["start", "lake", "x"]).entry).toEqual({ values: { a: ["start", "cave"] }, changes: {} });
});

test("anything else keeps its old value", () => {
    for (const [oldValue, newValue] of [[null, { a: 1 }], [{ a: 1 }, null], [{ a: 1 }, [1]], [[1], { 0: 1 }], [1, 2], ["x", "y"]]) {
        expect(undo(oldValue, newValue).entry).toEqual({ values: { a: oldValue }, changes: {} });
    }
});
