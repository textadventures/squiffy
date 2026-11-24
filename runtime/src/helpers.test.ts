// The compiler's list of the runtime's helpers, which its unknown-name warning relies on
// (squiffy/unknown-name, #526), must have every helper the runtime registers, and no others.
import { expect, test, vi, beforeEach, afterEach } from "vitest";
import globalJsdom from "global-jsdom";
import Handlebars from "handlebars";
import { init } from "./squiffy.runtime.js";
import { HELPERS_WITHOUT_VALUES } from "./textProcessor.js";
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

// A helper added in a later version mustn't change what {{name}} shows in a story that has an
// attribute of that name (#642), so on its own, every helper but those that do something with
// nothing given shows the attribute
test("{{name}} on its own shows the attribute, for every helper that needs values", async () => {
    const helpers = [...BUILT_IN_HELPERS].filter(name =>
        !HELPERS_WITHOUT_VALUES.has(name) && !["each", "if", "unless", "with", "log", "lookup"].includes(name));
    const script = "[[start]]:\n" + helpers.map(name => `${name}={{${name}}};`).join("\n");
    const result = await compile({ script });
    if (!result.success) throw new Error("Compile failed");
    const js = result.output.js.map(lines => new Function("squiffy", "get", "set", lines.join("\n")));
    const element = document.getElementById("squiffy")!;
    const api = await init({ element, story: { ...result.output.story, js: js as any }, persist: false, scroll: "none" });
    for (const name of helpers) api.set(name, `value of ${name}`);
    await api.begin();
    const text = element.textContent!;
    for (const name of helpers) expect(text, name).toContain(`${name}=value of ${name};`);
});
