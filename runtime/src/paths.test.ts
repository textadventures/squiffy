import { expect, test, describe } from "vitest";
import { parsePath, readTarget, valueAt, withValueAt } from "./paths.js";

describe("parsePath", () => {
    test.each([
        ["score", ["score"]],
        ["my attribute", ["my attribute"]],
        ["hero.hp", ["hero", "hp"]],
        ["inventory.0.name", ["inventory", "0", "name"]],
        ["inventory[0].name", ["inventory", "0", "name"]],
        ["inventory.[0].name", ["inventory", "0", "name"]],
        ["hero[\"max hp\"]", ["hero", "max hp"]],
        ["hero['max hp'].x", ["hero", "max hp", "x"]],
        // Not paths: the whole name is the attribute
        ["a..b", ["a..b"]],
        ["a.", ["a."]],
        [".a", [".a"]],
        ["a[0", ["a[0"]],
    ])("%s", (name, expected) => {
        expect(parsePath(name)).toEqual(expected);
    });

    test("names that reach the prototype aren't allowed", () => {
        expect(() => parsePath("hero.__proto__.x")).toThrow("__proto__");
        expect(() => parsePath("hero[constructor]")).toThrow("constructor");
    });
});

describe("valueAt and withValueAt", () => {
    test("reads values, and null for anything missing", () => {
        const hero = { hp: 10, items: [{ name: "lamp" }] };
        expect(valueAt(hero, ["items", "0", "name"])).toBe("lamp");
        expect(valueAt(hero, ["items", "1", "name"])).toBeNull();
        expect(valueAt(hero, ["hp", "x"])).toBeNull();
        expect(valueAt(hero, ["toString"])).toBeNull();
    });

    test("changes a copy, making objects that aren't there", () => {
        const hero = { hp: 10 };
        expect(withValueAt(hero, ["stats", "str"], "hero", 2)).toEqual({ hp: 10, stats: { str: 2 } });
        expect(hero).toEqual({ hp: 10 });
        expect(withValueAt(null, ["hp"], "hero", 1)).toEqual({ hp: 1 });
        expect(withValueAt([1, 2], ["1"], "list", 5)).toEqual([1, 5]);
    });

    test("can't go through a value that isn't an object", () => {
        expect(() => withValueAt(5, ["hp"], "hero", 1)).toThrow("hero isn't an object, so it has no hp");
        expect(() => withValueAt({ hp: 5 }, ["hp", "max"], "hero", 1)).toThrow("hero.hp isn't an object, so it has no max");
    });
});

describe("readTarget", () => {
    test.each([
        ["gold = 1", { attribute: "gold", segments: [], rest: " = 1" }],
        ["Zähler.größe = 1", { attribute: "Zähler", segments: [{ name: "größe" }], rest: " = 1" }],
        ["hero.hp += 5", { attribute: "hero", segments: [{ name: "hp" }], rest: " += 5" }],
        ["inventory[i + 1].name = \"x\"", { attribute: "inventory", segments: [{ index: "i + 1" }, { name: "name" }], rest: " = \"x\"" }],
        ["grid[a[0]][\"]\"]", { attribute: "grid", segments: [{ index: "a[0]" }, { index: "\"]\"" }], rest: "" }],
    ])("%s", (text, expected) => {
        expect(readTarget(text)).toEqual(expected);
    });

    test("isn't a target", () => {
        expect(readTarget("= 1")).toBeNull();
        expect(readTarget("a[0 = 1")).toBeNull();
    });
});
