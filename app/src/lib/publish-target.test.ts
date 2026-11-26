import { describe, expect, test } from "vitest";
import { chooseTarget, parsePublishTargets, withTarget } from "./publish-target.js";

describe("parsePublishTargets", () => {
    test("reads what was saved", () => {
        expect(parsePublishTargets('{"":"zip","abc":"online"}')).toEqual({ "": "zip", abc: "online" });
    });

    test("leaves out anything that isn't a way to publish", () => {
        expect(parsePublishTargets('{"abc":"online","def":"carrier pigeon","ghi":5}')).toEqual({ abc: "online" });
    });

    test("is empty for nothing, or something else", () => {
        expect(parsePublishTargets(null)).toEqual({});
        expect(parsePublishTargets("not json")).toEqual({});
        expect(parsePublishTargets('"zip"')).toEqual({});
        expect(parsePublishTargets("null")).toEqual({});
    });
});

describe("chooseTarget", () => {
    test("is a link the first time", () => {
        expect(chooseTarget({}, "abc")).toBe("link");
        expect(chooseTarget({}, undefined)).toBe("link");
    });

    test("is the story's own last choice", () => {
        expect(chooseTarget({ "": "js", abc: "zip" }, "abc")).toBe("zip");
    });

    test("is the last choice for any story, for one not published from here before", () => {
        expect(chooseTarget({ "": "html", abc: "zip" }, "def")).toBe("html");
        expect(chooseTarget({ "": "html", abc: "zip" }, undefined)).toBe("html");
    });
});

describe("withTarget", () => {
    test("remembers the choice for the story, and as the last one", () => {
        expect(withTarget({ abc: "zip" }, "def", "html")).toEqual({ "": "html", abc: "zip", def: "html" });
    });

    test("for a story with no ID, only as the last one", () => {
        expect(withTarget({ abc: "zip" }, undefined, "js")).toEqual({ "": "js", abc: "zip" });
    });
});
