import { expect, test, beforeEach, afterEach, beforeAll, vi } from "vitest";
import globalJsdom from "global-jsdom";
import { init } from "./squiffy.runtime.js";
import { compile as squiffyCompile } from "squiffy-compiler";
import { createSavesDialog, formatSaveTime } from "./savesDialog.js";
import { memorySaveSlots, type SaveSlots } from "./saveSlots.js";
import type { SquiffyApi } from "./types.js";

beforeAll(() => {
    vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-0000-0000-000000000000" });
});

let cleanup: () => void;

beforeEach(() => {
    cleanup = globalJsdom("<!DOCTYPE html><html><head><title>My Story</title></head><body><div id=\"squiffy\"></div></body></html>");
    // jsdom has no showModal()
    window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    window.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

afterEach(() => {
    localStorage.clear();
    cleanup();
});

const script = `[[a]]:
Welcome to the start. Go to [[b]].

[[b]]:
You are in b. Go to [[c]].

[[c]]:
You are in c.`;

const start = async () => {
    const element = document.getElementById("squiffy")!;
    const result = await squiffyCompile({ script, projectId: "story-1" });
    if (!result.success) throw new Error("Compile failed");
    const js = result.output.js.map(lines => new Function("squiffy", "get", "set", lines.join("\n")));
    const api = await init({ element, story: { js: js as any, ...result.output.story }, persist: false });
    await api.begin();
    return { api, element };
};

const click = async (api: SquiffyApi, element: HTMLElement, text: string) => {
    const link = [...element.querySelectorAll<HTMLElement>("a.squiffy-link")]
        .filter(l => l.textContent === text && !l.classList.contains("disabled")).pop()!;
    expect(await api.clickLink(link)).toBe(true);
};

// Lets the dialog's async handlers finish
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const setup = async (slots: SaveSlots = memorySaveSlots()) => {
    const { api, element } = await start();
    const dialog = createSavesDialog(api, { slots });
    await dialog.open();
    const el = dialog.element;
    const q = <T extends HTMLElement = HTMLElement>(selector: string) => el.querySelector<T>(selector)!;
    const rows = () => [...el.querySelectorAll<HTMLElement>(".squiffy-saves-row")].map(row => ({
        title: row.querySelector(".squiffy-saves-title")?.textContent,
        meta: row.querySelector(".squiffy-saves-meta")?.textContent ?? "",
    }));
    const save = async (name = "") => {
        q<HTMLInputElement>("form input").value = name;
        q<HTMLFormElement>("form").requestSubmit();
        await settle();
    };
    const row = (index: number) => el.querySelectorAll<HTMLElement>(".squiffy-saves-row")[index];
    const pick = async (index: number, action: string) => {
        row(index).querySelector<HTMLElement>(`[data-action=${action}]`)!.click();
        await settle();
    };
    const answer = async (yes: boolean) => {
        el.querySelector<HTMLElement>(`.squiffy-saves-confirm [data-answer=${yes ? "yes" : "no"}]`)!.click();
        await settle();
        await settle();
    };
    return { api, element, dialog, el, q, rows, save, row, pick, answer, slots };
};

test("it opens with no saves, on the name box", async () => {
    const { el, q } = await setup();
    expect(el.open).toBe(true);
    expect(q("h2").textContent).toBe("Saved games");
    expect(q(".squiffy-saves-empty").textContent).toBe("No saved games yet.");
    expect(document.activeElement).toBe(q("form input"));
});

test("saving adds a save, titled by its name or the text the player was reading, newest first", async () => {
    const { api, element, rows, save } = await setup();
    await save();
    await click(api, element, "b");
    await save("  Before c  ");
    expect(rows()).toEqual([
        { title: "Before c", meta: expect.stringMatching(/^Today, .* · You are in b\. Go to c\.$/) },
        { title: "Welcome to the start. Go to b.", meta: expect.stringMatching(/^Today, /) },
    ]);
});

test("loading a save asks first if there's progress since the last save, then closes", async () => {
    const { api, element, el, save, pick, answer } = await setup();
    await save();
    await click(api, element, "b");

    await pick(0, "load");
    expect(el.querySelector(".squiffy-saves-confirm p")!.textContent)
        .toBe("Load \"Welcome to the start. Go to b.\"? You'll lose anything you've done since you last saved.");
    await answer(false);
    expect(api.get("_section")).toBe("b");
    expect(el.open).toBe(true);

    await pick(0, "load");
    await answer(true);
    expect(api.get("_section")).toBe("a");
    expect(el.open).toBe(false);
});

test("loading straight after saving doesn't ask", async () => {
    const { api, element, el, save, pick } = await setup();
    await click(api, element, "b");
    await save();
    await pick(0, "load");
    await settle();
    expect(el.querySelector(".squiffy-saves-confirm")).toBeNull();
    expect(el.open).toBe(false);
    expect(api.get("_section")).toBe("b");
});

test("a dialog made before the story begins still asks before losing a restored game", async () => {
    const element = document.getElementById("squiffy")!;
    const result = await squiffyCompile({ script, projectId: "story-1" });
    if (!result.success) throw new Error("Compile failed");
    const js = result.output.js.map(lines => new Function("squiffy", "get", "set", lines.join("\n")));
    const story = { js: js as any, ...result.output.story };
    const first = await init({ element, story, persist: true });
    await first.begin();
    await click(first, element, "b");

    // A new page: the dialog is made first, as the published page does
    element.innerHTML = "";
    const api = await init({ element, story, persist: true });
    const slots = memorySaveSlots();
    await slots.add(api.getSave(), "Start");
    const dialog = createSavesDialog(api, { slots });
    await api.begin();
    await dialog.open();
    dialog.element.querySelector<HTMLElement>("[data-action=load]")!.click();
    await settle();
    expect(dialog.element.querySelector(".squiffy-saves-confirm")).not.toBeNull();
});

test("a save's menu opens and closes, and Escape closes it before the dialog", async () => {
    const { el, save, row, pick } = await setup();
    await save();
    const button = row(0).querySelector<HTMLElement>("[data-action=options]")!;
    expect(button.getAttribute("aria-label")).toBe("Options for Welcome to the start. Go to b.");
    const menu = row(0).querySelector<HTMLElement>("[role=menu]")!;
    expect(menu.hidden).toBe(true);

    await pick(0, "options");
    expect(menu.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.textContent).toBe("Overwrite");
    menu.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement?.textContent).toBe("Rename");

    const cancel = new window.Event("cancel", { cancelable: true });
    el.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
});

test("overwrite replaces a save with the game as it is now, keeping its name", async () => {
    const { api, element, rows, save, pick, answer } = await setup();
    await save("Mine");
    await click(api, element, "b");
    await pick(0, "overwrite");
    await answer(true);
    expect(rows()).toEqual([{ title: "Mine", meta: expect.stringContaining("You are in b.") }]);
});

test("rename changes a save's name, and an empty name makes it unnamed again", async () => {
    const { el, rows, save, row, pick } = await setup();
    await save("Old");
    await pick(0, "rename");
    let input = row(0).querySelector<HTMLInputElement>("input")!;
    expect(input.value).toBe("Old");
    input.value = "New";
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter" }));
    await settle();
    await settle();
    expect(rows()[0].title).toBe("New");

    await pick(0, "rename");
    input = row(0).querySelector<HTMLInputElement>("input")!;
    input.value = "  ";
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter" }));
    await settle();
    await settle();
    expect(rows()[0].title).toBe("Welcome to the start. Go to b.");
    expect(el.querySelector(".squiffy-saves-rename")).toBeNull();
});

test("delete asks first", async () => {
    const { el, rows, save, pick, answer } = await setup();
    await save("Mine");
    await pick(0, "delete");
    expect(el.querySelector(".squiffy-saves-confirm p")!.textContent).toBe("Delete \"Mine\"? This can't be undone.");
    await answer(false);
    expect(rows()).toHaveLength(1);
    await pick(0, "delete");
    await answer(true);
    expect(rows()).toHaveLength(0);
});

test("Save to file downloads the game as a .squiffy-save named after the page", async () => {
    const { api, q } = await setup();
    const blobs: Blob[] = [];
    URL.createObjectURL = (blob: Blob) => { blobs.push(blob); return "blob:x"; };
    URL.revokeObjectURL = () => {};
    let downloaded = "";
    window.HTMLAnchorElement.prototype.click = function () { downloaded = this.download; };
    q("[data-save-to-file]").click();
    expect(downloaded).toBe("My Story.squiffy-save");
    expect(JSON.parse(await blobs[0].text())).toEqual({ ...api.getSave(), savedAt: expect.any(String) });
});

test("Load from file loads a save, and says so when the file isn't one or is for another story", async () => {
    const { api, element, el, q } = await setup();
    await click(api, element, "b");
    const save = api.getSave();
    await click(api, element, "c");

    const input = q<HTMLInputElement>("input[type=file]");
    const choose = async (text: string) => {
        Object.defineProperty(input, "files", { configurable: true, value: [new window.File([text], "game.squiffy-save")] });
        input.dispatchEvent(new window.Event("change"));
        await settle();
        await settle();
    };

    await choose("not json");
    expect(q(".squiffy-saves-error").hidden).toBe(false);
    expect(q(".squiffy-saves-error").textContent).toBe("This file isn't a saved game.");

    await choose(JSON.stringify({ ...save, storyId: "another" }));
    // Progress since the last save, so it asks first
    el.querySelector<HTMLElement>(".squiffy-saves-confirm [data-answer=yes]")!.click();
    await settle();
    await settle();
    expect(q(".squiffy-saves-error").textContent).toBe("This saved game is for a different story.");
    expect(api.get("_section")).toBe("c");

    await choose(JSON.stringify(save));
    el.querySelector<HTMLElement>(".squiffy-saves-confirm [data-answer=yes]")!.click();
    await settle();
    await settle();
    expect(api.get("_section")).toBe("b");
    expect(el.open).toBe(false);
});

test("a store that fails says the game couldn't be saved", async () => {
    const slots = memorySaveSlots();
    slots.add = () => Promise.reject(new Error("full"));
    const { q, save, rows } = await setup(slots);
    await save();
    expect(q(".squiffy-saves-error").textContent).toBe("The game couldn't be saved. Try Save to file instead.");
    expect(rows()).toHaveLength(0);
});

test("the text can be translated", async () => {
    const { api } = await start();
    const dialog = createSavesDialog(api, { slots: memorySaveSlots(), strings: { saves: "Parties sauvegardées", save: "Sauvegarder", unknown: "x" } });
    await dialog.open();
    expect(dialog.element.querySelector("h2")!.textContent).toBe("Parties sauvegardées");
    expect(dialog.element.querySelector("form button")!.textContent).toBe("Sauvegarder");
    expect(dialog.element.querySelector(".squiffy-saves-empty")!.textContent).toBe("No saved games yet.");
});

test("formatSaveTime", () => {
    const now = new Date(2026, 10, 18, 20, 0);
    expect(formatSaveTime(new Date(2026, 10, 18, 9, 5).toISOString(), undefined, now)).toMatch(/^Today, /);
    expect(formatSaveTime(new Date(2026, 10, 17, 9, 5).toISOString(), undefined, now)).toMatch(/^Yesterday, /);
    expect(formatSaveTime(new Date(2026, 10, 1, 9, 5).toISOString(), undefined, now)).toMatch(/^1 Nov|^Nov 1/);
    expect(formatSaveTime(new Date(2025, 10, 1, 9, 5).toISOString(), undefined, now)).toContain("2025");
    expect(formatSaveTime("nonsense")).toBe("");
});
