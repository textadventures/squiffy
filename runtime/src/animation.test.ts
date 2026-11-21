// The built-in animations in animation.ts
import { afterAll, beforeAll, expect, test } from "vitest";
import globalJsdom from "global-jsdom";
import type { Animation as AnimationClass } from "./animation.js";

let cleanup: () => void;
let Animation: typeof AnimationClass;

// anime.js keeps the document it finds when it's first imported, so there's one DOM for the
// whole file, made before it's imported
beforeAll(async () => {
    cleanup = globalJsdom("<!DOCTYPE html><html><body></body></html>");
    // jsdom has no ResizeObserver or document.fonts, which anime.js's splitText uses to split text
    // into lines again when it's resized, and once the fonts have loaded
    (globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
    Object.defineProperty(document, "fonts", { value: { status: "loaded", ready: Promise.resolve() } });
    ({ Animation } = await import("./animation.js"));
});

afterAll(() => {
    cleanup();
});

// The characters the animation split the text into, grouped by the element that holds them
const charsByParent = (el: HTMLElement) => {
    const groups = new Map<Element, string>();
    for (const char of el.querySelectorAll("[data-char]")) {
        groups.set(char.parentElement!, (groups.get(char.parentElement!) ?? "") + char.textContent);
    }
    return [...groups.values()];
};

test.each([
    ["typewriter", {}],
    ["continue", { style: "wave" }],
])("%s keeps each word's characters together, so a line can't break inside a word", (name, params) => {
    const el = document.createElement("span");
    el.textContent = "Now, let's spin...";
    document.body.appendChild(el);

    new Animation().runAnimation(name, el, params, () => {}, false);

    expect(charsByParent(el)).toEqual(["Now,", "let's", "spin..."]);
});
