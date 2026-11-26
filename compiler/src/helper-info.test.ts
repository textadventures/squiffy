import { expect, test } from "vitest";
import { BUILT_IN_HELPERS } from "./helpers.js";
import { HELPER_INFO } from "./helper-info.js";

test("every built-in helper is described, for completion", () => {
    expect([...BUILT_IN_HELPERS].filter(name => !HELPER_INFO[name])).toEqual([]);
    expect(Object.keys(HELPER_INFO).filter(name => !BUILT_IN_HELPERS.has(name))).toEqual([]);
});
