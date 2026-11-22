import { expect, test, beforeEach, afterEach } from "vitest";
import globalJsdom from "global-jsdom";
import { init } from "./squiffy.runtime.js";
import { compile as squiffyCompile } from "squiffy-compiler";
import type { SquiffyInitOptions } from "./types.js";

// Persistent attributes (#539): squiffy.json's "persistent", attributes that belong to the player
// rather than the playthrough, such as the endings they've found

let cleanup: () => void;

beforeEach(() => {
    cleanup = globalJsdom("<!DOCTYPE html><html><body><div id=\"squiffy\"></div></body></html>");
});

afterEach(() => {
    localStorage.clear();
    cleanup();
});

const script = `[[start]]:
@set score = 1
Endings: {{#if endings}}{{length endings}}{{else}}none{{/if}}.
{{#if finished}}Welcome back.{{/if}}
[[Pebbles]](pebbles) [Forget]

[Forget]:
{{forget}}Forgotten.

[[pebbles]]:
@set endings.pebbles = true
@set finished
@set score = 2
The end.`;

const start = async (options: Partial<SquiffyInitOptions> = {}, persistent: string[] | undefined = ["endings", "finished"]) => {
    const element = document.getElementById("squiffy")!;
    element.innerHTML = "";
    const result = await squiffyCompile({ script, persistent, expressions: true });
    if (!result.success) throw new Error("Compile failed");
    const js = result.output.js.map(lines => new Function("squiffy", "get", "set", lines.join("\n")));
    const api = await init({ element, story: { js: js as any, ...result.output.story }, persist: false, scroll: "none", ...options });
    await api.begin();
    return { api, element };
};

const link = (element: HTMLElement, text: string) =>
    [...element.querySelectorAll<HTMLElement>("a.squiffy-link")].filter(l => l.textContent === text).pop()!;

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const text = (element: HTMLElement) => element.textContent!.replace(/\s+/g, " ");

test("The story's output lists its persistent attributes", async () => {
    const result = await squiffyCompile({ script, persistent: ["endings"] });
    if (!result.success) throw new Error("Compile failed");
    expect(result.output.story.persistent).toEqual(["endings"]);
    expect(await result.getJs()).toContain("story.persistent = [\"endings\"];");
});

test("Persistent attributes are set and read like any other", async () => {
    const { api, element } = await start();
    expect(text(element)).toContain("Endings: none.");
    await api.clickLink(link(element, "Pebbles"));
    expect(api.get("endings")).toEqual({ pebbles: true });
    expect(api.get("endings.pebbles")).toBe(true);
    expect(api.get("finished")).toBe(true);
    expect(api.getPersistent()).toEqual({ endings: { pebbles: true }, finished: true });
});

test("Restart, Back and saved games leave persistent attributes alone, and saves don't include them", async () => {
    const { api, element } = await start();
    const save = api.getSave();
    await api.clickLink(link(element, "Pebbles"));
    expect(api.getSave().state).not.toHaveProperty("endings");
    expect(api.getSave().state).not.toHaveProperty("finished");

    api.goBack();
    expect(api.get("score")).toBe(1);
    expect(api.get("endings")).toEqual({ pebbles: true });

    await api.loadSave(save);
    expect(api.get("finished")).toBe(true);

    api.restart();
    await settle();
    expect(api.get("_section")).toBe("start");
    expect(api.get("_visits")).toEqual({ start: 1 });
    expect(api.get("finished")).toBe(true);
    expect(text(element)).toContain("Endings: 1.");
    expect(text(element)).toContain("Welcome back.");
});

test("A saved game from before an attribute was persistent doesn't change it", async () => {
    const { api, element } = await start();
    await api.clickLink(link(element, "Pebbles"));
    const save = api.getSave();
    save.state.finished = false;
    await api.loadSave(save);
    expect(api.get("finished")).toBe(true);
});

test("Without \"persistent\", attributes are part of the game as before", async () => {
    const { api, element } = await start({}, []);
    await api.clickLink(link(element, "Pebbles"));
    expect(api.getSave().state).toHaveProperty("finished", true);
    api.restart();
    await settle();
    expect(api.get("finished")).toBeNull();
    expect(api.getPersistent()).toEqual({});
});

test("{{forget}} clears persistent attributes", async () => {
    const { api, element } = await start({ persistent: { finished: true, endings: { pebbles: true } } });
    expect(text(element)).toContain("Welcome back.");
    const changes: string[] = [];
    api.on("set", e => changes.push(e.attribute));
    await api.clickLink(link(element, "Forget"));
    expect(text(element)).toContain("Forgotten.");
    expect(api.get("finished")).toBeNull();
    expect(api.get("endings")).toBeNull();
    expect(api.getPersistent()).toEqual({});
    expect(changes).toEqual(expect.arrayContaining(["endings", "finished"]));
});

test("api.forget() clears the persistent attributes named, and only persistent ones", async () => {
    const { api } = await start({ persistent: { finished: true, endings: { pebbles: true } } });
    api.forget(["finished", "score"]);
    expect(api.get("finished")).toBeNull();
    expect(api.get("score")).toBe(1);
    expect(api.get("endings")).toEqual({ pebbles: true });
});

test("Persistent attributes are kept for the story when persist is on", async () => {
    const first = await start({ persist: true, storyId: "mystory" });
    await first.api.clickLink(link(first.element, "Pebbles"));
    first.api.dispose();
    expect(JSON.parse(localStorage.getItem("squiffy-persistent:mystory")!)).toEqual({ endings: { pebbles: true }, finished: true });

    // A new game, as after clearing the saved one
    localStorage.removeItem("mystory-_output");
    const { api, element } = await start({ persist: true, storyId: "mystory" });
    expect(text(element)).toContain("Welcome back.");
    expect(api.get("endings")).toEqual({ pebbles: true });

    api.restart();
    await settle();
    expect(localStorage.getItem("squiffy-persistent:mystory")).not.toBeNull();
});

test("Starting values given to init() are used in place of the browser's", async () => {
    localStorage.setItem("squiffy-persistent:mystory", JSON.stringify({ finished: true }));
    const { api } = await start({ persist: true, storyId: "mystory", persistent: { endings: { rock: true } } });
    expect(api.getPersistent()).toEqual({ endings: { rock: true } });
});
