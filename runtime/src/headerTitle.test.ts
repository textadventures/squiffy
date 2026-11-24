// The title in the page's header: the story's @title if squiffy.json's "headerTitle" shows it,
// and {{headertitle}}
import { expect, test, beforeEach, afterEach, vi } from "vitest";
import globalJsdom from "global-jsdom";
import { init } from "./squiffy.runtime.js";
import { compile as squiffyCompile } from "squiffy-compiler";
import type { SquiffyApi } from "./types.js";

let cleanup: () => void;

beforeEach(() => {
    cleanup = globalJsdom("<!DOCTYPE html><html><body><div id=\"squiffy\"></div></body></html>");
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    cleanup();
});

const start = async (script: string, options: { headerTitle?: boolean; persist?: boolean } = {}) => {
    const result = await squiffyCompile({ script, headerTitle: options.headerTitle });
    if (!result.success) throw new Error("Compile failed");
    const story = {
        ...result.output.story,
        js: result.output.js.map(lines => new Function("squiffy", "get", "set", lines.join("\n"))) as any,
    };
    const element = document.getElementById("squiffy")!;
    const api = await init({ element, story, persist: options.persist ?? false, storyId: "test", scroll: "none" });
    const changes: string[] = [];
    api.on("headerTitleChanged", e => changes.push(e.title));
    await api.begin();
    return { api, element, changes };
};

const click = async (element: HTMLElement, text: string) => {
    const link = [...element.querySelectorAll<HTMLElement>("a.squiffy-link")]
        .find(l => l.textContent == text && !l.classList.contains("disabled"));
    if (!link) throw new Error(`No link "${text}"`);
    link.click();
    await vi.runAllTimersAsync();
};

const story = `@title The Cave
[[outside]]:
Outside. [[Go in]](chapter2)

[[chapter2]]:
{{headertitle "Chapter 2"}}Inside. [[Go deeper]](deeper)

[[deeper]]:
{{headertitle ""}}Darkness. [[Come out]](out)

[[out]]:
{{headertitle}}Outside again.
`;

test("there's no title by default, even for a story with a @title", async () => {
    const { api } = await start("@title The Cave\nHello");
    expect(api.headerTitle()).toBe("");
});

test("squiffy.json's headerTitle shows the story's @title", async () => {
    const { api } = await start("@title The Cave\nHello", { headerTitle: true });
    expect(api.headerTitle()).toBe("The Cave");
});

test("{{headertitle}} sets the title, hides it, and goes back to the default", async () => {
    const { api, element, changes } = await start(story, { headerTitle: true });
    expect(api.headerTitle()).toBe("The Cave");
    await click(element, "Go in");
    expect(api.headerTitle()).toBe("Chapter 2");
    await click(element, "Go deeper");
    expect(api.headerTitle()).toBe("");
    await click(element, "Come out");
    expect(api.headerTitle()).toBe("The Cave");
    // It's announced as the story begins, too
    expect(changes).toEqual(["The Cave", "Chapter 2", "", "The Cave"]);
});

test("{{headertitle}} works without squiffy.json's headerTitle, whose default is none", async () => {
    const { api, element } = await start(story);
    await click(element, "Go in");
    expect(api.headerTitle()).toBe("Chapter 2");
    await click(element, "Go deeper");
    await click(element, "Come out");
    expect(api.headerTitle()).toBe("");
});

test("the title comes back with Back, restarting and saved games", async () => {
    const { api, element, changes } = await start(story, { headerTitle: true });
    await click(element, "Go in");
    const save = api.getSave();
    await click(element, "Go deeper");
    expect(api.headerTitle()).toBe("");

    api.goBack();
    await vi.runAllTimersAsync();
    expect(api.headerTitle()).toBe("Chapter 2");

    api.restart();
    await vi.runAllTimersAsync();
    expect(api.headerTitle()).toBe("The Cave");

    await api.loadSave(save);
    expect(api.headerTitle()).toBe("Chapter 2");
    expect(changes).toEqual(["The Cave", "Chapter 2", "", "Chapter 2", "The Cave", "Chapter 2"]);
});

test("a saved game in the browser comes back with its title", async () => {
    const first = await start(story, { persist: true });
    await click(first.element, "Go in");
    first.api.dispose();
    document.getElementById("squiffy")!.innerHTML = "";
    const { api }: { api: SquiffyApi } = await start(story, { persist: true });
    expect(api.headerTitle()).toBe("Chapter 2");
});
