// @transition (#489): how a section or passage appears
import { expect, test, beforeEach, afterEach, vi } from "vitest";
import globalJsdom from "global-jsdom";
import { init } from "./squiffy.runtime.js";
import { compile as squiffyCompile } from "squiffy-compiler";

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

const sectionElement = (element: HTMLElement, name: string) =>
    element.querySelector<HTMLElement>(`.squiffy-output-section[data-section="${name}"]`)!;

const passageElement = (element: HTMLElement, name: string) =>
    element.querySelector<HTMLElement>(`.squiffy-output-passage[data-passage="${name}"]`)!;

// What a transition puts on an element while it plays
const transition = (el: HTMLElement) => el.classList.contains("squiffy-transition")
    ? { name: el.getAttribute("data-transition"), time: el.style.getPropertyValue("--squiffy-transition-time") }
    : null;

const story = `
[[forest]]:
@transition fade
The forest. [[Go to the cave]](cave), [look up], [listen]

[look up]:
@transition zoom 300ms
The stars are out.

[listen]:
Owls.

[[cave]]:
@transition slide-up 1.5s
@clear
The cave. [[Leave]](outside)

[[outside]]:
Outside.
`;

test("A section's transition plays as it appears, with its time", async () => {
    const { element } = await start(story);
    expect(transition(sectionElement(element, "forest"))).toEqual({ name: "fade", time: "" });
    expect(sectionElement(element, "forest").classList).toContain("fade");

    await click(element, "Go to the cave");
    expect(transition(sectionElement(element, "cave"))).toEqual({ name: "slide-up", time: "1500ms" });

    await click(element, "Leave");
    expect(transition(sectionElement(element, "outside"))).toBeNull();
});

test("A passage has its own transition, or else its section's", async () => {
    const { element } = await start(story);
    await click(element, "look up");
    expect(transition(passageElement(element, "look up"))).toEqual({ name: "zoom", time: "300ms" });

    await click(element, "listen");
    expect(transition(passageElement(element, "listen"))).toEqual({ name: "fade", time: "" });
});

test("The master section's transition is for every section, unless one has @transition none", async () => {
    const { element } = await start(`
[[]]:
@transition blur 1s

[[a]]:
A. [[b]] [p]

[p]:
P.

[[b]]:
@transition none
B.
`);
    expect(transition(sectionElement(element, "a"))).toEqual({ name: "blur", time: "1000ms" });
    await click(element, "p");
    expect(transition(passageElement(element, "p"))).toEqual({ name: "blur", time: "1000ms" });
    await click(element, "b");
    expect(transition(sectionElement(element, "b"))).toBeNull();
});

test("The transition's class comes off when it ends", async () => {
    const { element } = await start(story);
    const forest = sectionElement(element, "forest");
    // An animation in the text doesn't end the section's transition
    forest.querySelector("p, div")!.dispatchEvent(new window.Event("animationend", { bubbles: true }));
    expect(transition(forest)).not.toBeNull();

    forest.dispatchEvent(new window.Event("animationend", { bubbles: true }));
    expect(transition(forest)).toBeNull();
    expect(forest.classList).not.toContain("fade");
    expect(forest.hasAttribute("style")).toBe(false);
});

test("Going back past @clear doesn't play the transition again", async () => {
    const { api, element } = await start(story);
    await click(element, "Go to the cave");
    api.goBack();
    await vi.runAllTimersAsync();
    expect(transition(sectionElement(element, "forest"))).toBeNull();
});

test("A saved game doesn't play the transitions again when it's loaded", async () => {
    const first = await start(story, { persist: true });
    await click(first.element, "Go to the cave");
    expect(transition(sectionElement(first.element, "cave"))).not.toBeNull();
    first.api.dispose();
    first.element.innerHTML = "";

    const second = await start(story, { persist: true });
    expect(sectionElement(second.element, "cave")).not.toBeNull();
    expect(second.element.querySelector(".squiffy-transition")).toBeNull();
});
