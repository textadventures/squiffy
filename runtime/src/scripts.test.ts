import { expect, test, beforeEach, afterEach } from "vitest";
import globalJsdom from "global-jsdom";
import { init } from "./squiffy.runtime.js";
import { compile as squiffyCompile } from "squiffy-compiler";
import type { SquiffyScriptApi, Story } from "./types.js";

// The story's own scripts (#528): the squiffy:ready event, and what it gives them

let cleanup: () => void;

beforeEach(() => {
    cleanup = globalJsdom("<!DOCTYPE html><html><body><div id=\"squiffy\"></div></body></html>");
});

afterEach(() => {
    localStorage.clear();
    cleanup();
});

const compile = async (script: string): Promise<Story> => {
    const result = await squiffyCompile({ script, expressions: true });
    if (!result.success) throw new Error("Compile failed");
    return {
        js: result.output.js.map(lines => new Function("squiffy", "get", "set", lines.join("\n"))) as any,
        ...result.output.story,
    };
};

const script = `[[start]]:
@set score = 1
Hello. [[Next]](kitchen) [look]

[look]:
@set looked = true
A look.

[[kitchen]]:
@set score = 2
The kitchen.`;

// A script's listener, as on a published page: on document, before the story is set up
const listen = () => {
    const ready: SquiffyScriptApi[] = [];
    document.addEventListener("squiffy:ready", event => {
        ready.push((event as CustomEvent<SquiffyScriptApi>).detail);
    });
    return ready;
};

const link = (text: string) => Array.from(document.querySelectorAll<HTMLElement>("a.squiffy-link"))
    .reverse().find(a => a.textContent == text)!;

test("squiffy:ready bubbles to document before the story begins, so a script hears the first section", async () => {
    const ready = listen();
    const element = document.getElementById("squiffy")!;
    const api = await init({ element, story: await compile(script) });
    expect(ready).toHaveLength(1);
    expect(ready[0].element).toBe(element);

    const navigated: unknown[] = [];
    ready[0].on("navigated", e => navigated.push(e));
    await api.begin();
    expect(navigated).toEqual([{ section: "start" }]);

    await api.clickLink(link("look"));
    await api.clickLink(link("Next"));
    expect(navigated).toEqual([{ section: "start" }, { section: "start", passage: "look" }, { section: "kitchen" }]);
});

test("a script hears about going back and restarting, and can stop listening", async () => {
    const ready = listen();
    const api = await init({ element: document.getElementById("squiffy")!, story: await compile(script), scroll: "element" });
    const sections: string[] = [];
    const stop = ready[0].on("navigated", e => sections.push(e.section));
    await api.begin();
    await api.clickLink(link("Next"));
    api.goBack();
    api.restart();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(sections).toEqual(["start", "kitchen", "start", "start"]);

    stop();
    await api.clickLink(link("Next"));
    expect(sections).toHaveLength(4);
});

test("a script can read and set attributes, go to a section, and see what's been seen", async () => {
    const ready = listen();
    const api = await init({ element: document.getElementById("squiffy")!, story: await compile(script) });
    const squiffy = ready[0];
    const set: unknown[] = [];
    squiffy.on("set", e => { if (!e.attribute.startsWith("_")) set.push(e); });
    await api.begin();
    expect(squiffy.get("score")).toBe(1);
    expect(set).toContainEqual({ attribute: "score", value: 1 });

    squiffy.set("gold", 5);
    expect(api.get("gold")).toBe(5);

    await api.clickLink(link("look"));
    expect(squiffy.story.seen("look")).toBe(true);
    expect(squiffy.story.visits("kitchen")).toBe(0);
    expect(squiffy.story.passages()).toEqual(["look"]);
    expect(squiffy.story.sections()).toEqual(["start", "kitchen"]);
    await squiffy.story.go("kitchen");
    expect(api.get("_section")).toBe("kitchen");
    expect(squiffy.get("score")).toBe(2);
});

test("a script can read a player setting, and hear when it changes", async () => {
    const ready = listen();
    const story = await compile(script);
    story.settings = [{ name: "effects", label: "Effects", type: "toggle", default: true }];
    const api = await init({ element: document.getElementById("squiffy")!, story });
    const squiffy = ready[0];
    const changed: unknown[] = [];
    squiffy.on("settingChanged", e => changed.push(e));
    expect(squiffy.getSetting("effects")).toBe(true);
    api.setSetting("effects", false);
    expect(squiffy.getSetting("effects")).toBe(false);
    expect(changed).toEqual([{ name: "effects", value: false }]);
});

test("a script can only listen for the story's own events, not the page's", async () => {
    const ready = listen();
    await init({ element: document.getElementById("squiffy")!, story: await compile(script) });
    expect(() => ready[0].on("restartRequested" as any, () => {})).toThrow(/can't listen for "restartRequested"/);
    // It isn't something the API has, such as begin() or dispose()
    expect("begin" in ready[0]).toBe(false);
});
