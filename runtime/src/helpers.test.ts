// The compiler's list of the runtime's helpers, which its unknown-name warning relies on
// (squiffy/unknown-name, #526), must have every helper the runtime registers, and no others.
import { expect, test, vi, beforeEach, afterEach } from "vitest";
import globalJsdom from "global-jsdom";
import Handlebars from "handlebars";
import { init } from "./squiffy.runtime.js";
import { compile, BUILT_IN_HELPERS } from "squiffy-compiler";

let cleanup: () => void;

beforeEach(() => {
    cleanup = globalJsdom("<!DOCTYPE html><html><body><div id=\"squiffy\"></div></body></html>");
});

afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
});

test("the compiler knows every helper the runtime registers", async () => {
    const create = vi.spyOn(Handlebars, "create");
    const result = await compile({ script: "Hello" });
    if (!result.success) throw new Error("Compile failed");
    const story = { ...result.output.story, js: [] } as any;
    await init({ element: document.getElementById("squiffy")!, story, persist: false, storyId: "test", scroll: "none" });
    const registered = new Set<string>();
    for (const created of create.mock.results) {
        for (const name of Object.keys((created.value as typeof Handlebars).helpers)) {
            // The runtime's internal helpers, and Handlebars' for a missing helper
            if (!name.startsWith("__") && name != "helperMissing" && name != "blockHelperMissing") registered.add(name);
        }
    }
    expect([...BUILT_IN_HELPERS].sort(), "Update BUILT_IN_HELPERS in compiler/src/helpers.ts").toEqual([...registered].sort());
});
