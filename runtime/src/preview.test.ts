import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import globalJsdom from "global-jsdom";
import { compile } from "squiffy-compiler";
import { createPreview } from "./preview.js";
import type { PreviewMessage } from "./preview-protocol.js";
import type { Story } from "./types.js";

beforeAll(() => {
    vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-0000-0000-000000000000" });
});

let cleanup: () => void;
let objectUrls: string[];

beforeEach(() => {
    cleanup = globalJsdom("<!DOCTYPE html><html><head></head><body><div id=\"squiffy\"></div></body></html>");
    objectUrls = [];
    // jsdom has no object URLs
    URL.createObjectURL = () => {
        const url = `blob:preview/${objectUrls.length}`;
        objectUrls.push(url);
        return url;
    };
    URL.revokeObjectURL = () => {};
    // Nor scrolling, which the preview's scroll: "element" uses
    window.Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
    cleanup();
});

// The compiled story module, as a host would send it
const compileJs = async (script: string) => {
    const result = await compile({ script });
    if (!result.success) throw new Error("Compile failed");
    return result.getJs();
};

// Node can't import from blob URLs, so evaluate the module's one export here instead
const loadModule = async (js: string) => {
    const body = js.replace("export const story = {};", "const story = {};") + "\nreturn story;";
    return { story: new Function(body)() as Story };
};

const setUp = () => {
    const messages: PreviewMessage[] = [];
    const element = document.getElementById("squiffy")!;
    const preview = createPreview({ element, send: m => messages.push(m), loadModule });
    return { preview, messages, element };
};

const script = `@title Test
[[start]]:
@set score=1
Welcome. Go to the [[cellar]] or [look].

[look]:
@set looked
You look around. ![A cat](images/cat.png)

[[cellar]]:
It's dark down here.
`;

describe("preview", () => {
    test("loads a story and reports what happens", async () => {
        const { preview, messages, element } = setUp();
        await preview.receive({ type: "load", story: { js: await compileJs(script) } });

        expect(element.textContent).toContain("Welcome.");
        expect(messages).toEqual([
            { type: "canGoBackChanged", canGoBack: false },
            // The story-wide turn count (#377), which isn't internal, so it's reported
            { type: "attributeSet", name: "turns", value: 0 },
            { type: "attributeSet", name: "score", value: 1 },
            { type: "navigated", section: "start" },
            { type: "loaded" },
        ]);

        messages.length = 0;
        element.querySelector<HTMLElement>("a[data-passage='look']")!.click();
        await vi.waitFor(() => expect(messages.some(m => m.type == "navigated")).toBe(true));
        expect(messages).toEqual([
            { type: "attributeSet", name: "turns", value: 1 },
            // Where the player was before (#56), which isn't internal either
            { type: "attributeSet", name: "previous", value: "start" },
            { type: "attributeSet", name: "looked", value: true },
            { type: "canGoBackChanged", canGoBack: true },
            { type: "navigated", section: "start", passage: "look" },
        ]);

        messages.length = 0;
        await preview.receive({ type: "back" });
        expect(element.textContent).not.toContain("You look around");
        expect(messages).toContainEqual({ type: "navigated", section: "start" });
        expect(messages).toContainEqual({ type: "canGoBackChanged", canGoBack: false });
    });

    test("starts at a section or a passage", async () => {
        const { preview, messages, element } = setUp();
        const js = await compileJs(script);

        await preview.receive({ type: "load", story: { js }, startAt: { section: "cellar" } });
        expect(element.textContent).toContain("It's dark");
        expect(element.textContent).not.toContain("Welcome");

        messages.length = 0;
        await preview.receive({ type: "load", story: { js }, startAt: { section: "start", passage: "look" } });
        expect(element.textContent).toContain("Welcome.");
        expect(element.textContent).toContain("You look around.");
        expect(messages.filter(m => m.type == "navigated")).toEqual([
            { type: "navigated", section: "start" },
            { type: "navigated", section: "start", passage: "look" },
        ]);

        // An unknown section starts from the beginning
        await preview.receive({ type: "load", story: { js }, startAt: { section: "nowhere" } });
        expect(element.textContent).toContain("Welcome.");
    });

    test("resolves assets to object URLs it makes itself", async () => {
        const { preview, element } = setUp();
        await preview.receive({
            type: "assets",
            assets: { files: { "./images/cat.png": new Uint8Array([1, 2, 3]) }, urls: { "other.png": "https://example.com/other.png" } },
        });
        await preview.receive({ type: "load", story: { js: await compileJs(script) }, startAt: { section: "start", passage: "look" } });
        expect(element.querySelector("img")!.getAttribute("src")).toBe(objectUrls[0]);
    });

    test("restart, and hot updates that keep the story's state", async () => {
        const { preview, element } = setUp();
        await preview.receive({ type: "load", story: { js: await compileJs(script) } });
        element.querySelector<HTMLElement>("a[data-section='cellar']")!.click();
        await vi.waitFor(() => expect(element.textContent).toContain("It's dark"));

        await preview.receive({ type: "update", js: await compileJs(script.replace("It's dark", "It's pitch black")) });
        expect(element.textContent).toContain("It's pitch black");
        expect(element.textContent).toContain("Welcome.");

        await preview.receive({ type: "restart" });
        await vi.waitFor(() => expect(element.textContent).not.toContain("pitch black"));
        expect(element.textContent).toContain("Welcome.");
    });

    test("adds the story's stylesheets, replacing the previous story's", async () => {
        const { preview } = setUp();
        const js = await compileJs(script);
        await preview.receive({ type: "load", story: { js, css: ["body { color: red; }"] } });
        await preview.receive({ type: "load", story: { js, css: ["body { color: blue; }"] } });
        // After the preview's own (empty) theme style
        expect([...document.head.querySelectorAll("style")].map(s => s.textContent)).toEqual(["", "body { color: blue; }"]);
    });

    test("sets the theme before the story's stylesheets, so they can override it", async () => {
        const { preview } = setUp();
        const js = await compileJs(script);
        await preview.receive({ type: "load", story: { js, css: [":root { color-scheme: light; }"] } });
        await preview.receive({ type: "theme", theme: "dark" });
        const styles = () => [...document.head.querySelectorAll("style")].map(s => s.textContent);
        expect(styles()).toEqual([":root { color-scheme: dark; }", ":root { color-scheme: light; }"]);

        await preview.receive({ type: "theme", theme: "system" });
        expect(styles()[0]).toBe("");
    });

    test("reports errors", async () => {
        const messages: PreviewMessage[] = [];
        const preview = createPreview({
            element: document.getElementById("squiffy")!,
            send: m => messages.push(m),
            loadModule: async () => { throw new Error("Bad story"); },
        });
        await preview.receive({ type: "load", story: { js: "" } });
        expect(messages).toMatchObject([{ type: "runtimeError", message: "Bad story" }]);
    });

    test("ignores messages for a story that hasn't loaded", async () => {
        const { preview, messages } = setUp();
        await preview.receive({ type: "restart" });
        await preview.receive({ type: "back" });
        await preview.receive({ type: "update", js: await compileJs(script) });
        expect(messages).toEqual([]);
    });
});
