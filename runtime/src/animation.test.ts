// The built-in animations in animation.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
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

describe("with the player's system set to reduce motion", () => {
    beforeEach(() => {
        window.matchMedia = ((media: string) => ({
            matches: media === "(prefers-reduced-motion: reduce)",
            media,
            addEventListener() {},
            removeEventListener() {},
        })) as any;
    });

    afterEach(() => {
        delete (window as any).matchMedia;
    });

    const run = (name: string, params: Record<string, any> = {}, loop = false) => {
        const el = document.createElement("span");
        el.textContent = "Now, let's spin...";
        document.body.appendChild(el);
        const done = new Promise<void>(resolve => {
            new Animation().runAnimation(name, el, params, resolve, loop);
        });
        return { el, done };
    };

    test.each(["typewriter", "toast"])("%s fades the whole text in, instead of a piece at a time", async (name) => {
        const { el, done } = run(name);
        expect(el.querySelector("[data-char], [data-word]")).toBeNull();
        expect(el.textContent).toBe("Now, let's spin...");
        // Still finishes, so what comes after it is shown
        await done;
    });

    test.each(["typewriter", "toast", "fadeIn"])("%s with loop=true just shows the text", (name) => {
        const { el } = run(name, {}, true);
        expect(el.innerHTML).toBe("Now, let's spin...");
        expect(el.getAttribute("style")).toBeNull();
    });

    test("continue's wave doesn't ripple, but is still a link", () => {
        let continued = false;
        const el = document.createElement("span");
        el.textContent = "Step inside";
        document.body.appendChild(el);
        new Animation().runAnimation("continue", el, { style: "wave" }, () => continued = true, false);
        expect(el.querySelector("[data-char]")).toBeNull();
        expect(el.classList.contains("squiffy-continue")).toBe(true);
        el.click();
        expect(continued).toBe(true);
    });

    test("a custom animation is told, in params.reducedMotion", () => {
        const animation = new Animation();
        const seen: any[] = [];
        animation.registerAnimation("spin", (_el, params, onComplete) => {
            seen.push(params.reducedMotion);
            onComplete();
        });
        animation.runAnimation("spin", document.createElement("span"), {}, () => {}, false);
        delete (window as any).matchMedia;
        animation.runAnimation("spin", document.createElement("span"), {}, () => {}, false);
        expect(seen).toEqual([true, false]);
    });
});
