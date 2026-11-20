// Classes on the story's element (#449): @class for the current section, and {{addclass}},
// {{removeclass}}, {{toggleclass}} and {{hasclass}}
import { expect, test, beforeEach, afterEach, vi } from "vitest";
import globalJsdom from "global-jsdom";
import { init } from "./squiffy.runtime.js";
import { compile as squiffyCompile } from "squiffy-compiler";

let cleanup: () => void;

beforeEach(() => {
    cleanup = globalJsdom("<!DOCTYPE html><html><body><div id=\"squiffy\" class=\"mine\"></div></body></html>");
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    cleanup();
});

const start = async (script: string, options: { persist?: boolean } = {}) => {
    const result = await squiffyCompile({ script });
    if (!result.success) throw new Error("Compile failed");
    const story = {
        ...result.output.story,
        js: result.output.js.map(lines => new Function("squiffy", "get", "set", lines.join("\n"))) as any,
    };
    const element = document.getElementById("squiffy")!;
    const api = await init({ element, story, persist: options.persist ?? false, storyId: "test", scroll: "none" });
    await api.begin();
    return { api, element };
};

const click = async (element: HTMLElement, text: string) => {
    const link = [...element.querySelectorAll<HTMLElement>("a.squiffy-link")]
        .find(l => l.textContent == text && !l.classList.contains("disabled"));
    if (!link) throw new Error(`No link "${text}"`);
    link.click();
    await vi.runAllTimersAsync();
};

// The classes on the story's element, other than the page's own
const classes = (element: HTMLElement) => [...element.classList].filter(c => c != "mine").sort();

const story = `
[[forest]]:
@class night forest
The forest. [[Go to the cave]](cave), [look up]

[look up]:
@class stars
The stars are out.

[[cave]]:
@class dark
The cave. [[Leave]](outside)

[[outside]]:
Outside.
`;

test("@class puts classes on the story's element while the section is the current one", async () => {
    const { element } = await start(story);
    expect(classes(element)).toEqual(["forest", "night"]);

    await click(element, "Go to the cave");
    expect(classes(element)).toEqual(["dark"]);

    await click(element, "Leave");
    expect(classes(element)).toEqual([]);
    // The page's own class is left alone
    expect(element.classList.contains("mine")).toBe(true);
});

test("@class in a passage adds to the section's classes, until the section changes", async () => {
    const { element } = await start(story);
    await click(element, "look up");
    expect(classes(element)).toEqual(["forest", "night", "stars"]);

    await click(element, "Go to the cave");
    expect(classes(element)).toEqual(["dark"]);
});

test("Going back puts the classes back", async () => {
    const { api, element } = await start(story);
    await click(element, "look up");
    await click(element, "Go to the cave");

    api.goBack();
    await vi.runAllTimersAsync();
    expect(classes(element)).toEqual(["forest", "night", "stars"]);

    api.goBack();
    await vi.runAllTimersAsync();
    expect(classes(element)).toEqual(["forest", "night"]);
});

test("Loading a saved game puts its classes on", async () => {
    const { api, element } = await start(story);
    const save = api.getSave();
    await click(element, "Go to the cave");
    expect(classes(element)).toEqual(["dark"]);

    await api.loadSave(save);
    await vi.runAllTimersAsync();
    expect(classes(element)).toEqual(["forest", "night"]);
});

test("A story carried on from where it was left has its classes", async () => {
    const first = await start(story, { persist: true });
    await click(first.element, "Go to the cave");
    first.api.dispose();
    expect(classes(first.element)).toEqual([]);
    first.element.innerHTML = "";

    const second = await start(story, { persist: true });
    expect(classes(second.element)).toEqual(["dark"]);
});

test("The master section's @class is on every section", async () => {
    const { element } = await start(`
[[]]:
@class story

[[a]]:
@class one
[[b]]

[[b]]:
B
`);
    expect(classes(element)).toEqual(["one", "story"]);
    await click(element, "b");
    expect(classes(element)).toEqual(["story"]);
});

test("{{addclass}} and {{removeclass}} change classes that stay until they're removed", async () => {
    const { api, element } = await start(`
[[a]]:
{{addclass "dark" "rain"}}[[b]]

[[b]]:
@class cave
[[c]]

[[c]]:
{{removeclass "dark"}}{{#if (hasclass "rain")}}Still raining.{{/if}}
`);
    expect(classes(element)).toEqual(["dark", "rain"]);
    await click(element, "b");
    expect(classes(element)).toEqual(["cave", "dark", "rain"]);
    await click(element, "c");
    expect(classes(element)).toEqual(["rain"]);
    expect(element.textContent).toContain("Still raining.");

    api.goBack();
    await vi.runAllTimersAsync();
    expect(classes(element)).toEqual(["cave", "dark", "rain"]);
});

test("{{toggleclass}} turns a class on and off, and takes several separated by spaces", async () => {
    const { element } = await start(`
[[a]]:
{{toggleclass "big loud"}}[[b]]

[[b]]:
{{toggleclass "loud"}}B
`);
    expect(classes(element)).toEqual(["big", "loud"]);
    await click(element, "b");
    expect(classes(element)).toEqual(["big"]);
});

test("{{hasclass}} checks classes from @class and {{addclass}}", async () => {
    const { element } = await start(`
[[a]]:
@class night
{{#if (hasclass "night")}}It's night.{{/if}}
{{#if (hasclass "day")}}It's day.{{/if}}
{{#if (hasclass "night day")}}Both.{{/if}}
`);
    expect(element.textContent).toContain("It's night.");
    expect(element.textContent).not.toContain("It's day.");
    expect(element.textContent).not.toContain("Both.");
});

test("Restarting takes the classes off", async () => {
    const { api, element } = await start(`
[[a]]:
{{addclass "dark"}}[[b]]

[[b]]:
@class cave
B
`);
    await click(element, "b");
    expect(classes(element)).toEqual(["cave", "dark"]);
    api.restart();
    await vi.runAllTimersAsync();
    expect(classes(element)).toEqual(["dark"]);
});
