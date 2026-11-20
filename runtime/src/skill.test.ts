// Keeps the docs and the Claude Code plugin's Squiffy skill (plugins/squiffy) from going stale:
// every helper the runtime registers must be in the helpers reference on the docs site, and in
// the skill's own helpers reference, which an author's AI agent reads instead of the docs.
import { expect, test, vi, beforeEach, afterEach } from "vitest";
import globalJsdom from "global-jsdom";
import Handlebars from "handlebars";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { init } from "./squiffy.runtime.js";
import { compile } from "squiffy-compiler";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const skillHelpers = path.join(root, "plugins/squiffy/skills/squiffy/references/helpers.md");
const docsHelpers = path.join(root, "site/src/content/docs/helpers-reference.mdx");

// Handlebars' own helpers, documented as part of Handlebars, and the runtime's internal ones
const builtIn = new Set(["helperMissing", "blockHelperMissing", "each", "if", "unless", "with", "log", "lookup"]);

let cleanup: () => void;

beforeEach(() => {
    cleanup = globalJsdom("<!DOCTYPE html><html><body><div id=\"squiffy\"></div></body></html>");
});

afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
});

const registeredHelpers = async () => {
    const create = vi.spyOn(Handlebars, "create");
    const result = await compile({ script: "Hello" });
    if (!result.success) throw new Error("Compile failed");
    const story = { ...result.output.story, js: [] } as any;
    await init({ element: document.getElementById("squiffy")!, story, persist: false, storyId: "test", scroll: "none" });
    const names = new Set<string>();
    for (const created of create.mock.results) {
        for (const name of Object.keys((created.value as typeof Handlebars).helpers)) {
            if (!builtIn.has(name) && !name.startsWith("__")) names.add(name);
        }
    }
    return [...names].sort();
};

// A helper counts as mentioned when its name is in code, as `name`, `#name`, {{name, {{#name or (name
const mentioned = (text: string, name: string) =>
    new RegExp("(`#?|\\{\\{#?|\\()" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(text);

test("finds the runtime's helpers", async () => {
    const helpers = await registeredHelpers();
    expect(helpers).toContain("seen");
    expect(helpers).toContain("rotate");
    expect(helpers.length).toBeGreaterThan(40);
});

test("every helper is in the docs' helpers reference", async () => {
    const text = fs.readFileSync(docsHelpers, "utf8");
    const missing = (await registeredHelpers()).filter(name => !mentioned(text, name));
    expect(missing, `Add these to ${path.relative(root, docsHelpers)}`).toEqual([]);
});

test("every helper is in the Squiffy skill's helpers reference", async () => {
    const text = fs.readFileSync(skillHelpers, "utf8");
    const missing = (await registeredHelpers()).filter(name => !mentioned(text, name));
    expect(missing, `Add these to ${path.relative(root, skillHelpers)}`).toEqual([]);
});
