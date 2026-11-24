import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import globalJsdom from "global-jsdom";
import { compile } from "squiffy-compiler";
import { ANNOUNCEMENT_TIME, createPreview } from "./preview.js";
import type { PreviewMessage } from "./preview-protocol.js";
import type { Panel, PlayerSetting, Story } from "./types.js";

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
const compileJs = async (script: string, panels?: Panel[], settings?: PlayerSetting[]) => {
    const result = await compile({ script, panels, settings });
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
            { type: "themeFixed", fixed: false },
            { type: "usesSound", usesSound: false },
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

    test("reports a story with sound, mutes it, and stops it when another story is loaded (#444)", async () => {
        const played: { src: string; muted: boolean; paused: boolean }[] = [];
        vi.stubGlobal("Audio", class {
            muted = false;
            paused = true;
            volume = 1;
            loop = false;
            preload = "";
            constructor(public src = "") {
                played.push(this);
            }
            play() {
                this.paused = false;
                return Promise.resolve();
            }
            pause() {
                this.paused = true;
            }
            addEventListener() {}
        });
        try {
            const { preview, messages } = setUp();
            await preview.receive({ type: "muted", muted: true });
            await preview.receive({ type: "load", story: { js: await compileJs("@music theme.mp3\nHello.") } });
            expect(messages).toContainEqual({ type: "usesSound", usesSound: true });
            const music = played.filter(a => !a.paused);
            expect(music.map(a => a.muted)).toEqual([true]);

            await preview.receive({ type: "muted", muted: false });
            expect(music[0].muted).toBe(false);

            await preview.receive({ type: "load", story: { js: await compileJs("Hello.") } });
            expect(played.filter(a => !a.paused)).toEqual([]);
        }
        finally {
            vi.unstubAllGlobals();
            vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-0000-0000-000000000000" });
        }
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

    test("reads the opening text out with a screen reader when the story starts or restarts (#639)", async () => {
        const { preview, element } = setUp();
        const announcer = () => document.querySelector(".squiffy-preview-announcer")!;
        await preview.receive({ type: "load", story: { js: await compileJs(script) } });
        expect(announcer().getAttribute("aria-live")).toBe("polite");
        await vi.waitFor(() => expect(announcer().textContent).toBe("Welcome. Go to the cellar or look."));

        // Not what's shown after a link is clicked: the runtime moves the focus to that instead
        element.querySelector<HTMLElement>("a[data-section='cellar']")!.click();
        await vi.waitFor(() => expect(element.textContent).toContain("It's dark"));
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(announcer().textContent).toBe("Welcome. Go to the cellar or look.");

        // Something else, to see the opening is read out again
        announcer().textContent = "";
        await preview.receive({ type: "restart" });
        await vi.waitFor(() => expect(announcer().textContent).toBe("Welcome. Go to the cellar or look."));
    });

    test("empties the opening text it read out, so browse mode doesn't read it twice (#640)", async () => {
        const { preview } = setUp();
        const announcer = () => document.querySelector(".squiffy-preview-announcer")!;
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            await preview.receive({ type: "load", story: { js: await compileJs(script) } });
            await vi.waitFor(() => expect(announcer().textContent).toBe("Welcome. Go to the cellar or look."));
            vi.advanceTimersByTime(ANNOUNCEMENT_TIME);
            expect(announcer().textContent).toBe("");
        } finally {
            vi.useRealTimers();
        }
    });

    test("hot updates replace the story's stylesheets, keeping its state", async () => {
        const { preview, element, messages } = setUp();
        const js = await compileJs(script);
        const styles = () => [...document.head.querySelectorAll("style")].map(s => s.textContent);
        const fixed = () => messages.filter(m => m.type == "themeFixed");
        await preview.receive({ type: "load", story: { js, css: ["body { color: red; }", "p { margin: 0; }"] } });
        element.querySelector<HTMLElement>("a[data-section='cellar']")!.click();
        await vi.waitFor(() => expect(element.textContent).toContain("It's dark"));

        messages.length = 0;
        await preview.receive({ type: "update", js, css: ["body { color: blue; }"] });
        // After the preview's own (empty) theme style
        expect(styles()).toEqual(["", "body { color: blue; }"]);
        expect(element.textContent).toContain("It's dark");
        expect(fixed()).toEqual([{ type: "themeFixed", fixed: false }]);

        // A stylesheet that sets color-scheme
        messages.length = 0;
        await preview.receive({ type: "update", js, css: [":root { color-scheme: light; }"] });
        expect(fixed()).toEqual([{ type: "themeFixed", fixed: true }]);

        // The same stylesheets again, or none given, change nothing
        messages.length = 0;
        await preview.receive({ type: "update", js, css: [":root { color-scheme: light; }"] });
        await preview.receive({ type: "update", js });
        expect(styles()).toEqual(["", ":root { color-scheme: light; }"]);
        expect(fixed()).toEqual([]);
    });

    test("swaps the url()s in the story's stylesheets for its assets' URLs", async () => {
        const { preview } = setUp();
        const js = await compileJs(script);
        const css = `@font-face { src: url("fonts/a.woff2") format("woff2"), url(missing.woff); }
body { background: url('./bg.png'), url(https://example.com/x.png); }`;
        const style = () => [...document.head.querySelectorAll("style")][1].textContent;
        await preview.receive({ type: "assets", assets: { files: { "fonts/a.woff2": new Uint8Array([1]), "bg.png": new Uint8Array([2]) } } });
        await preview.receive({ type: "load", story: { js, css: [css] } });
        expect(style()).toBe(`@font-face { src: url("blob:preview/0") format("woff2"), url(missing.woff); }
body { background: url("blob:preview/1"), url(https://example.com/x.png); }`);

        // New assets go to the stylesheets that are already there
        await preview.receive({ type: "assets", assets: { files: { "fonts/a.woff2": new Uint8Array([3]) } } });
        expect(style()).toContain("src: url(\"blob:preview/2\")");
        expect(style()).toContain("url('./bg.png')");
        // The same stylesheet again changes nothing
        await preview.receive({ type: "update", js, css: [css] });
        expect(style()).toContain("src: url(\"blob:preview/2\")");
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

    test("says whether the story's stylesheets set its color-scheme", async () => {
        const { preview, messages } = setUp();
        const js = await compileJs(script);
        const fixed = () => messages.filter(m => m.type == "themeFixed");

        await preview.receive({ type: "theme", theme: "dark" });
        await preview.receive({ type: "load", story: { js, css: ["body { color: red; }"] } });
        expect(fixed()).toEqual([{ type: "themeFixed", fixed: false }]);

        messages.length = 0;
        await preview.receive({ type: "load", story: { js, css: [":root { color-scheme: light; }"] } });
        expect(fixed()).toEqual([{ type: "themeFixed", fixed: true }]);
        // Finding out doesn't change the theme the host set
        expect(document.head.querySelector("style")!.textContent).toBe(":root { color-scheme: dark; }");
    });

    test("shows the story's panels, and shows them again when they change", async () => {
        const { preview, element } = setUp();
        const panelScript = "[[]]:\n\n[status]:\nScore: {{score}}\n\n" + script;
        await preview.receive({ type: "load", story: { js: await compileJs(panelScript, [{ passage: "status", label: "Status", position: "side" }]) } });
        expect(element.querySelector(".squiffy-preview-header button.squiffy-panel-button")!.textContent).toBe("Status");
        expect(element.querySelector(".squiffy-preview-body > aside section")!.innerHTML).toBe("<p>Score: 1</p>");

        await preview.receive({ type: "update", js: await compileJs(panelScript, [{ passage: "status", label: "Score" }]) });
        expect(element.querySelector("aside")).toBeNull();
        expect([...element.querySelectorAll("button.squiffy-panel-button")].map(b => b.textContent)).toEqual(["Score"]);

        // A new story has no panels left over
        await preview.receive({ type: "load", story: { js: await compileJs(script) } });
        expect(element.querySelector("button.squiffy-panel-button")).toBeNull();
        expect(document.querySelectorAll("dialog.squiffy-panel-dialog")).toHaveLength(0);
    });

    test("shows a Settings button for a story with settings, which opens the Settings dialog", async () => {
        const { preview, element } = setUp();
        const settings: PlayerSetting[] = [{ name: "warnings", label: "Content warnings", type: "toggle" }];
        const panels: Panel[] = [{ passage: "status", label: "Status" }];
        const panelScript = "[[]]:\n\n[status]:\nScore: {{score}}\n\n" + script;
        await preview.receive({ type: "load", story: { js: await compileJs(panelScript, panels, settings) } });
        const buttons = () => [...element.querySelectorAll<HTMLButtonElement>(".squiffy-preview-header button")];
        expect(buttons().map(b => b.title || b.textContent)).toEqual(["Status", "Settings"]);
        buttons()[1].click();
        expect(document.querySelector("dialog.squiffy-settings label")!.textContent).toBe("Content warnings");

        // Still after the panels' buttons when they change
        await preview.receive({ type: "update", js: await compileJs(panelScript, [{ passage: "status", label: "Score" }], settings) });
        expect(buttons().map(b => b.title || b.textContent)).toEqual(["Score", "Settings"]);

        await preview.receive({ type: "update", js: await compileJs(panelScript, panels) });
        expect(buttons().map(b => b.title || b.textContent)).toEqual(["Status"]);

        await preview.receive({ type: "load", story: { js: await compileJs(script) } });
        expect(document.querySelectorAll("dialog.squiffy-settings")).toHaveLength(0);
    });

    test("puts the story's classes on #squiffy, as a published story does", async () => {
        const { preview, element } = setUp();
        const settings: PlayerSetting[] = [{ name: "warnings", label: "Content warnings", type: "toggle" }];
        const classScript = "[[start]]:\n@class dark\nIn the [[cellar]].\n\n[[cellar]]:\nDown here.\n";
        await preview.receive({ type: "load", story: { js: await compileJs(classScript, undefined, settings) } });
        expect(element.id).toBe("squiffy");
        expect(element.classList.contains("dark")).toBe(true);
        expect(document.querySelector("div#squiffy.dark")).toBe(element);

        // A setting's class, when the player changes it
        element.querySelector<HTMLButtonElement>(".squiffy-settings-button")!.click();
        const toggle = document.querySelector<HTMLInputElement>("dialog.squiffy-settings input[type=checkbox]")!;
        toggle.checked = true;
        toggle.dispatchEvent(new window.Event("change"));
        await Promise.resolve();
        expect(element.classList.contains("setting-warnings")).toBe(true);

        // A section's class goes when the player leaves it
        element.querySelector<HTMLAnchorElement>("a.squiffy-link")!.click();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(element.classList.contains("dark")).toBe(false);
        expect(element.classList.contains("setting-warnings")).toBe(true);

        // And a new story starts with none
        await preview.receive({ type: "load", story: { js: await compileJs(script) } });
        expect([...element.classList]).toEqual([]);
    });

    test("shows no buttons of its own unless the host asks", async () => {
        const { preview, element } = setUp();
        await preview.receive({ type: "load", story: { js: await compileJs(script) } });
        expect(element.querySelectorAll(".squiffy-preview-header button")).toHaveLength(0);
    });

    test("shows the published page's buttons when the host asks, for a reader", async () => {
        // jsdom has no showModal() or close()
        window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
        window.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
        const { preview, messages, element } = setUp();
        const settings: PlayerSetting[] = [{ name: "warnings", label: "Content warnings", type: "toggle" }];
        const panels: Panel[] = [{ passage: "status", label: "Status" }];
        const panelScript = "[[]]:\n\n[status]:\nScore: {{score}}\n\n" + script;
        await preview.receive({ type: "controls", controls: { back: true, restart: true, mute: true, theme: true, strings: { restart: "Recommencer" } } });
        await preview.receive({ type: "load", story: { js: await compileJs(panelScript, panels, settings) } });
        expect(element.querySelector(".squiffy-preview-header")!.classList.contains("squiffy-preview-controls")).toBe(true);
        const buttons = () => [...element.querySelectorAll<HTMLButtonElement>(".squiffy-preview-header button")];
        const shown = () => buttons().filter(b => !b.hidden).map(b => b.id || b.title || b.textContent);
        // In the published page's order, with the panels' buttons first. Mute only for a story with sound.
        expect(shown()).toEqual(["Status", "squiffy-back", "squiffy-restart", "Settings", "squiffy-theme"]);
        expect(buttons().find(b => b.id == "squiffy-mute")!.hidden).toBe(true);

        // Back follows whether there's anywhere to go back to
        const back = element.querySelector<HTMLButtonElement>("#squiffy-back")!;
        expect(back.disabled).toBe(true);
        element.querySelector<HTMLElement>("a[data-passage='look']")!.click();
        await vi.waitFor(() => expect(back.disabled).toBe(false));
        back.click();
        await vi.waitFor(() => expect(back.disabled).toBe(true));

        // Restart asks first, in the story's own words
        const restart = element.querySelector<HTMLButtonElement>("#squiffy-restart")!;
        expect(restart.title).toBe("Recommencer");
        element.querySelector<HTMLElement>("a[data-passage='look']")!.click();
        await vi.waitFor(() => expect(element.textContent).toContain("You look around"));
        restart.click();
        document.querySelector<HTMLElement>("dialog.squiffy-confirm [data-answer=yes]")!.click();
        await vi.waitFor(() => expect(element.textContent).not.toContain("You look around"));

        // Light/dark sets the theme, and tells the host so it can remember it
        const theme = element.querySelector<HTMLButtonElement>("#squiffy-theme")!;
        expect(theme.dataset.next).toBe("dark");
        theme.click();
        expect(messages).toContainEqual({ type: "themeChosen", theme: "dark" });
        expect(document.head.querySelector("style")!.textContent).toBe(":root { color-scheme: dark; }");
        expect(theme.dataset.next).toBe("light");
        // Back to the system's own theme
        theme.click();
        expect(messages).toContainEqual({ type: "themeChosen", theme: "system" });
        expect(document.head.querySelector("style")!.textContent).toBe("");

        // Settings stays before mute and light/dark when the story changes
        await preview.receive({ type: "update", js: await compileJs(panelScript, [{ passage: "status", label: "Score" }], settings) });
        expect(shown()).toEqual(["Score", "squiffy-back", "squiffy-restart", "Settings", "squiffy-theme"]);

        // Hidden for a story whose CSS fixes its theme
        await preview.receive({ type: "load", story: { js: await compileJs(script), css: [":root { color-scheme: light; }"] } });
        expect(shown()).toEqual(["squiffy-back", "squiffy-restart"]);

        // And gone when the host asks for none
        await preview.receive({ type: "controls", controls: {} });
        expect(buttons()).toHaveLength(0);
    });

    test("shows the story's title and an edit button when the host asks, in one row with the rest", async () => {
        const { preview, messages, element } = setUp();
        const settings: PlayerSetting[] = [{ name: "warnings", label: "Content warnings", type: "toggle" }];
        const panels: Panel[] = [{ passage: "status", label: "Status" }];
        const panelScript = "[[]]:\n\n[status]:\nScore: {{score}}\n\n" + script;
        await preview.receive({ type: "controls", controls: { restart: true, theme: true, title: "Test", edit: true } });
        await preview.receive({ type: "load", story: { js: await compileJs(panelScript, panels, settings) } });
        const header = () => element.querySelector(".squiffy-preview-header")!;
        const items = () => [...header().querySelectorAll<HTMLElement>(".squiffy-preview-title, button")]
            .map(e => e.id || e.title || e.textContent);
        expect(items()).toEqual(["Test", "Status", "squiffy-restart", "Settings", "squiffy-theme", "squiffy-edit"]);

        // The panels' and Settings buttons stay between the title and the edit button when they change
        await preview.receive({ type: "update", js: await compileJs(panelScript, [{ passage: "status", label: "Score" }], settings) });
        expect(items()).toEqual(["Test", "Score", "squiffy-restart", "Settings", "squiffy-theme", "squiffy-edit"]);
        await preview.receive({ type: "update", js: await compileJs(panelScript, panels) });
        await preview.receive({ type: "update", js: await compileJs(panelScript, panels, settings) });
        expect(items()).toEqual(["Test", "Status", "squiffy-restart", "Settings", "squiffy-theme", "squiffy-edit"]);

        element.querySelector<HTMLButtonElement>("#squiffy-edit")!.click();
        expect(messages).toContainEqual({ type: "editRequested" });
        expect(element.querySelector<HTMLButtonElement>("#squiffy-edit")!.title).toBe("Open in editor");

        await preview.receive({ type: "controls", controls: { title: "Another" } });
        expect(items()).toEqual(["Another", "Status", "Settings"]);
    });

    test("shows the title the story's own header would, in place of the host's", async () => {
        const { preview, element } = setUp();
        const titleScript = "@title The Cave\n[[start]]:\nOutside. [[Go in]](inside)\n\n[[inside]]:\n{{headertitle \"Chapter 2\"}}Inside.\n";
        const result = await compile({ script: titleScript, headerTitle: true });
        if (!result.success) throw new Error("Compile failed");
        const title = () => element.querySelector(".squiffy-preview-title")?.textContent;
        const header = () => element.querySelector(".squiffy-preview-header")!;

        // As in the editor, which asks for no controls
        await preview.receive({ type: "load", story: { js: await result.getJs() } });
        expect(title()).toBe("The Cave");
        expect(header().classList.contains("squiffy-preview-controls")).toBe(true);
        element.querySelector<HTMLElement>("a.squiffy-link")!.click();
        await vi.waitFor(() => expect(title()).toBe("Chapter 2"));

        // The player's title is shown only when the story has none of its own
        await preview.receive({ type: "controls", controls: { title: "From the host" } });
        expect(title()).toBe("Chapter 2");
        await preview.receive({ type: "load", story: { js: await compileJs(titleScript) } });
        expect(title()).toBe("From the host");
        await preview.receive({ type: "controls", controls: {} });
        expect(title()).toBeUndefined();
        expect(header().classList.contains("squiffy-preview-controls")).toBe(false);
    });

    test("the mute button mutes the story, and tells the host (#444)", async () => {
        vi.stubGlobal("Audio", class {
            muted = false;
            paused = true;
            volume = 1;
            loop = false;
            preload = "";
            constructor(public src = "") {}
            play() {
                this.paused = false;
                return Promise.resolve();
            }
            pause() {
                this.paused = true;
            }
            addEventListener() {}
        });
        try {
            const { preview, messages, element } = setUp();
            await preview.receive({ type: "controls", controls: { mute: true } });
            await preview.receive({ type: "load", story: { js: await compileJs("@music theme.mp3\nHello.") } });
            const mute = element.querySelector<HTMLButtonElement>("#squiffy-mute")!;
            expect(mute.hidden).toBe(false);
            expect(mute.title).toBe("Mute");
            mute.click();
            expect(messages).toContainEqual({ type: "mutedChosen", muted: true });
            expect(mute.title).toBe("Unmute");
            expect(mute.classList.contains("squiffy-muted")).toBe(true);

            // The host's own mute shows on the button too
            await preview.receive({ type: "muted", muted: false });
            expect(mute.title).toBe("Mute");
        }
        finally {
            vi.unstubAllGlobals();
            vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-0000-0000-000000000000" });
        }
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

    test("reloads the page when the host asks, as it does before the next story after one with scripts (#528)", async () => {
        const reload = vi.fn();
        const preview = createPreview({ element: document.getElementById("squiffy")!, send: () => {}, loadModule, reload });
        await preview.receive({ type: "reload" });
        expect(reload).toHaveBeenCalledOnce();
    });

    test("ignores messages for a story that hasn't loaded", async () => {
        const { preview, messages } = setUp();
        await preview.receive({ type: "restart" });
        await preview.receive({ type: "back" });
        await preview.receive({ type: "update", js: await compileJs(script) });
        expect(messages).toEqual([]);
    });
});
