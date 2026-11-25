import { expect, test, beforeEach, afterEach, beforeAll, vi } from "vitest";
import globalJsdom from "global-jsdom";
import { init } from "./squiffy.runtime.js";
import { compile as squiffyCompile } from "squiffy-compiler";
import { createStartMenu, startAtFromAddress, addressForStart } from "./startMenu.js";
import type { Story } from "./types.js";

beforeAll(() => {
    vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-0000-0000-000000000000" });
});

let cleanup: () => void;

beforeEach(() => {
    cleanup = globalJsdom("<!DOCTYPE html><html><head><title>My Story</title></head><body><div id=\"header\"><button id=\"restart\"></button></div><div id=\"squiffy\"></div></body></html>");
    // jsdom has no showModal()
    window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    window.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

afterEach(() => {
    localStorage.clear();
    cleanup();
});

const script = `[[a]]:
Welcome to the start. Go to [[the vault]].

+++Continue...
More.

[[the vault]]:
{{#if has_key}}The door is open, and you have {{score}} points.{{else}}The door is locked.{{/if}}

[[shortcuts]]:
@test
[[To the vault with the key]](vault with key)

[[vault with key]]:
@set has_key
@set score = 7
{{goto "the vault"}}`;

const compileStory = async (): Promise<Story> => {
    const result = await squiffyCompile({ script, expressions: true });
    if (!result.success) throw new Error("Compile failed");
    const js = result.output.js.map(lines => new Function("squiffy", "get", "set", lines.join("\n")));
    return { js: js as any, ...result.output.story };
};

const menu = async (search: string, strings?: Record<string, string>) => createStartMenu({
    story: await compileStory(), buttons: document.getElementById("header")!, search, strings,
});

const listed = () => [...document.querySelectorAll(".squiffy-start-menu-list > *")].map(element =>
    element.tagName == "H3" ? `# ${element.textContent}` : [...element.querySelectorAll("a")].map(a => a.textContent));

test("an address says where to start, and what to set first", async () => {
    const story = await compileStory();
    expect(startAtFromAddress("", story)).toEqual({});
    expect(startAtFromAddress("?other=1", story)).toEqual({});
    expect(startAtFromAddress("?start=a", story)).toEqual({ startAt: { section: "a" } });
    expect(startAtFromAddress("?start=the+vault", story)).toEqual({ startAt: { section: "the vault" } });
    expect(startAtFromAddress("?start=the%20vault&set=has_key&set=score%3D5", story)).toEqual({
        startAt: { section: "the vault", set: ["has_key", "score=5"] },
    });
});

test("an address that names a section the story doesn't have says so", async () => {
    const story = await compileStory();
    expect(startAtFromAddress("?start=vault", story)).toEqual({ notFound: "vault" });
    expect(startAtFromAddress("?start=toString", story)).toEqual({ notFound: "toString" });
});

test("a section's address is one startAtFromAddress reads back", async () => {
    const story = await compileStory();
    expect(addressForStart("the vault")).toBe("?start=the%20vault");
    expect(startAtFromAddress(addressForStart("a & b = c?"), { ...story, sections: { "a & b = c?": {} } }).startAt).toEqual({ section: "a & b = c?" });
});

test("the menu's button is first in the header, and opens a list of the sections as links", async () => {
    const startMenu = await menu("");
    expect(document.getElementById("header")!.firstElementChild).toBe(startMenu.button);
    expect(startMenu.button.title).toBe("Start at a section");
    expect(startMenu.startAt).toBeUndefined();
    expect(startMenu.element.hasAttribute("open")).toBe(false);

    startMenu.button.click();
    expect(startMenu.element.hasAttribute("open")).toBe(true);
    // Test sections first, and no sections without names of their own
    expect(listed()).toEqual([["From the beginning"], "# Test sections", ["shortcuts"], "# All sections", ["a", "the vault", "vault with key"]]);
    expect(document.querySelector<HTMLAnchorElement>("a[data-section='the vault']")!.getAttribute("href")).toBe("?start=the%20vault");
});

test("typing narrows the list", async () => {
    const startMenu = await menu("");
    startMenu.open();
    const find = startMenu.element.querySelector<HTMLInputElement>("input")!;
    find.value = "VAULT";
    find.dispatchEvent(new window.Event("input"));
    expect(listed()).toEqual(["# All sections", ["the vault", "vault with key"]]);
});

test("the section the address starts at is marked", async () => {
    const startMenu = await menu("?start=the+vault");
    expect(startMenu.startAt).toEqual({ section: "the vault" });
    startMenu.open();
    expect([...document.querySelectorAll("a[aria-current]")].map(a => a.textContent)).toEqual(["the vault"]);
});

test("a section that isn't there opens the menu, saying so", async () => {
    const startMenu = await menu("?start=valt", { noSection: "Pas de section « [name] »." });
    expect(startMenu.startAt).toBeUndefined();
    expect(startMenu.element.hasAttribute("open")).toBe(true);
    expect(startMenu.element.querySelector("[role=alert]")!.textContent).toBe("Pas de section « valt ».");
});

test("without test sections, the list has no headings", async () => {
    const story = await compileStory();
    delete story.sections.shortcuts.test;
    createStartMenu({ story, buttons: document.getElementById("header")!, search: "" }).open();
    expect(listed()).toEqual([["From the beginning"], ["a", "the vault", "shortcuts", "vault with key"]]);
});

test("the list starts with a way back to the beginning, even when that's text with no name", async () => {
    const result = await squiffyCompile({ script: "Before any section. [[a]]\n\n" + script, expressions: true });
    if (!result.success) throw new Error("Compile failed");
    const story = { js: [], ...result.output.story } as unknown as Story;
    const startMenu = createStartMenu({ story, buttons: document.getElementById("header")!, search: "?start=a", strings: { fromStart: "Depuis le début" } });
    startMenu.open();
    const first = document.querySelector<HTMLAnchorElement>(".squiffy-start-menu-list a")!;
    expect(first.textContent).toBe("Depuis le début");
    // An address with ?start=, so the browser's saved game doesn't carry on from where it was
    expect(first.getAttribute("href")).toBe(addressForStart(story.start));
    expect(startAtFromAddress(first.getAttribute("href")!, story).startAt).toEqual({ section: story.start });
    expect(first.hasAttribute("aria-current")).toBe(false);

    // It's not a section to find by name
    const find = startMenu.element.querySelector<HTMLInputElement>("input")!;
    find.value = "beg";
    find.dispatchEvent(new window.Event("input"));
    expect(listed()).toEqual([]);
});

const begin = async (search: string) => {
    const story = await compileStory();
    const element = document.getElementById("squiffy")!;
    const api = await init({ element, story, persist: true, storyId: "test" });
    await api.begin(startAtFromAddress(search, story).startAt);
    return { api, element };
};

test("the story starts at the address's section, with its attributes set", async () => {
    const { api, element } = await begin("?start=the+vault&set=has_key&set=score=5");
    expect(api.get("_section")).toBe("the vault");
    expect(element.textContent).toContain("The door is open, and you have 5 points.");
    expect(element.textContent).not.toContain("Welcome");
});

test("a saved game is ignored when the address says where to start", async () => {
    await begin("");
    document.getElementById("squiffy")!.innerHTML = "";
    const { api, element } = await begin("?start=the+vault");
    expect(api.get("_section")).toBe("the vault");
    expect(element.textContent).toContain("The door is locked.");
});

test("a test section sets up a scene and goes on to it", async () => {
    const { api, element } = await begin("?start=vault+with+key");
    await vi.waitFor(() => expect(api.get("_section")).toBe("the vault"));
    expect(element.textContent).toContain("The door is open, and you have 7 points.");
});
