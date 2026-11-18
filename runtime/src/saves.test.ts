import { expect, test, beforeEach, afterEach, beforeAll, vi } from "vitest";
import globalJsdom from "global-jsdom";
import { init } from "./squiffy.runtime.js";
import { compile as squiffyCompile } from "squiffy-compiler";
import type { SavedGame } from "./types.js";

beforeAll(() => {
    vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-0000-0000-000000000000" });
});

let cleanup: () => void;

beforeEach(() => {
    cleanup = globalJsdom("<!DOCTYPE html><html><body><div id=\"squiffy\"></div></body></html>");
});

afterEach(() => {
    localStorage.clear();
    cleanup();
});

const script = `[[a]]:
@set score = 1
Welcome to the start. Go to [[b]] or read [more].

[more]:
More text.

[[b]]:
@set score = 2
You are in b. Go to [[c]].

[[c]]:
@set score = 3
You are in c.`;

const compileStory = async (text: string, projectId?: string) => {
    const result = await squiffyCompile({ script: text, projectId });
    if (!result.success) throw new Error("Compile failed");
    const js = result.output.js.map(lines => new Function("squiffy", "get", "set", lines.join("\n")));
    return { js: js as any, ...result.output.story };
};

const start = async (options: { projectId?: string; persist?: boolean; text?: string } = {}) => {
    const element = document.getElementById("squiffy")!;
    element.innerHTML = "";
    const story = await compileStory(options.text ?? script, options.projectId);
    const api = await init({ element, story, persist: options.persist ?? false });
    await api.begin();
    return { api, element };
};

const click = async (api: Awaited<ReturnType<typeof start>>["api"], element: HTMLElement, text: string) => {
    const link = [...element.querySelectorAll<HTMLElement>("a.squiffy-link")]
        .filter(l => l.textContent === text && !l.classList.contains("disabled")).pop();
    if (!link) throw new Error(`No link "${text}"`);
    expect(await api.clickLink(link)).toBe(true);
};

test("getSave gives where the player is, what they were reading, and every attribute", async () => {
    const { api, element } = await start({ projectId: "story-1" });
    await click(api, element, "b");
    const save = api.getSave();
    expect(save.format).toBe("squiffy-save");
    expect(save.version).toBe(1);
    expect(save.storyId).toBe("story-1");
    expect(save.section).toBe("b");
    expect(save.passage).toBeNull();
    expect(save.summary).toBe("You are in b. Go to c.");
    expect(save.state.score).toBe(2);
    expect(save.state._output).toContain("You are in b.");
    expect(new Date(save.savedAt).getTime()).not.toBeNaN();
    // It's JSON
    expect(JSON.parse(JSON.stringify(save))).toEqual(save);
});

test("the summary is a heading the section starts with, or its paragraphs with spaces between", async () => {
    const withHeading = await start({ text: "# Day One\n\nYou start work." });
    expect(withHeading.api.getSave().summary).toBe("Day One");
    const paragraphs = await start({ text: "First.\n\nSecond.<br>Third." });
    expect(paragraphs.api.getSave().summary).toBe("First. Second. Third.");
});

test("a long summary is cut at a word", async () => {
    const long = "word ".repeat(40).trim();
    const { api } = await start({ text: long });
    const summary = api.getSave().summary;
    expect(summary.endsWith("word…")).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(101);
});

test("loadSave puts the game back as it was, and Back still works", async () => {
    const { api, element } = await start();
    await click(api, element, "b");
    const save = JSON.parse(JSON.stringify(api.getSave())) as SavedGame;

    await click(api, element, "c");
    expect(api.get("score")).toBe(3);

    const navigated = vi.fn();
    const canGoBackChanged = vi.fn();
    api.on("navigated", navigated);
    api.on("canGoBackChanged", canGoBackChanged);
    expect(await api.loadSave(save)).toEqual({ success: true });

    expect(api.get("score")).toBe(2);
    expect(api.get("_section")).toBe("b");
    expect(element.textContent).toContain("You are in b.");
    expect(element.textContent).not.toContain("You are in c.");
    expect(navigated).toHaveBeenCalledWith({ section: "b" });
    expect(canGoBackChanged).toHaveBeenCalledWith({ canGoBack: true });

    // Carries on from there
    await click(api, element, "c");
    expect(api.get("score")).toBe(3);

    // And goes back through the loaded game's history
    api.goBack();
    api.goBack();
    expect(api.get("_section")).toBe("a");
    expect(api.get("score")).toBe(1);
    expect(api.canGoBack()).toBe(false);
});

test("loadSave keeps passages", async () => {
    const { api, element } = await start();
    await click(api, element, "more");
    const save = api.getSave();
    expect(save.passage).toBe("more");
    await click(api, element, "b");

    await api.loadSave(save);
    expect(element.textContent).toContain("More text.");
    expect(api.get("_passage")).toBe("more");
    api.goBack();
    expect(element.textContent).not.toContain("More text.");
});

test("a loaded game replaces the automatic save", async () => {
    const { api, element } = await start({ persist: true });
    await click(api, element, "b");
    const save = api.getSave();
    await click(api, element, "c");
    await api.loadSave(save);

    // A new page carries on from the loaded game
    const again = await start({ persist: true });
    expect(again.api.get("_section")).toBe("b");
    expect(again.api.get("score")).toBe(2);
    expect(again.element.textContent).not.toContain("You are in c.");
});

test("attributes set after the save are gone once it's loaded", async () => {
    const { api, element } = await start({ persist: true });
    const save = api.getSave();
    api.set("extra", "yes");
    await click(api, element, "b");
    await api.loadSave(save);
    expect(api.get("extra")).toBeNull();
    expect(Object.keys(localStorage).some(key => key.endsWith("-extra"))).toBe(false);
});

test("a save from a different story isn't loaded", async () => {
    const { api, element } = await start({ projectId: "story-1" });
    const save = { ...api.getSave(), storyId: "story-2" };
    await click(api, element, "b");
    expect(await api.loadSave(save)).toEqual({ success: false, error: "wrongStory" });
    expect(api.get("_section")).toBe("b");
});

test("a save from a story with no id, or into one, is loaded", async () => {
    const { api, element } = await start({ projectId: "story-1" });
    const save = { ...api.getSave(), storyId: null };
    await click(api, element, "b");
    expect(await api.loadSave(save)).toEqual({ success: true });
    expect(api.get("_section")).toBe("a");

    const other = await start();
    expect(await other.api.loadSave({ ...save, storyId: "story-1" })).toEqual({ success: true });
});

test("something that isn't a save isn't loaded", async () => {
    const { api } = await start();
    const save = api.getSave();
    for (const bad of [null, "text", {}, { ...save, format: "other" }, { ...save, version: 2 }, { ...save, state: {} }]) {
        expect(await api.loadSave(bad as any)).toEqual({ success: false, error: "notASave" });
    }
});

test("a save whose section has gone starts the story again, keeping its attributes", async () => {
    const { api, element } = await start();
    await click(api, element, "b");
    const save = api.getSave();
    const changed = await start({ text: "[[a]]:\nNew start. Go to [[z]].\n\n[[z]]:\nZ." });
    expect(await changed.api.loadSave(save)).toEqual({ success: true });
    expect(changed.api.get("_section")).toBe("a");
    expect(changed.element.textContent).toContain("New start.");
    expect(changed.element.textContent).not.toContain("You are in b.");
});
