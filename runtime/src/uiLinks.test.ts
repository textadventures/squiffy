import { expect, test, beforeEach, afterEach, beforeAll, vi } from "vitest";
import globalJsdom from "global-jsdom";
import { init } from "./squiffy.runtime.js";
import { compile as squiffyCompile } from "squiffy-compiler";
import { confirmDialog } from "./confirmDialog.js";
import type { SquiffyApi, SquiffyInitOptions } from "./types.js";

// {{restart}} and {{saves}} links (#452), and the dialog that asks before restarting

beforeAll(() => {
    vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-0000-0000-000000000000" });
});

let cleanup: () => void;

beforeEach(() => {
    cleanup = globalJsdom("<!DOCTYPE html><html><head><title>My Story</title></head><body><div id=\"squiffy\"></div></body></html>");
    // jsdom has no showModal()
    window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    window.HTMLDialogElement.prototype.close = function () {
        this.removeAttribute("open");
        this.dispatchEvent(new window.Event("close"));
    };
});

afterEach(() => {
    localStorage.clear();
    cleanup();
});

const script = `[[start]]:
@set score = 1
Hello. [[Next]](end)

[[end]]:
The end. {{restart text="Play again"}} {{restart confirm=false}} {{saves}} {{saves text="Save your game"}}`;

const start = async (options: Partial<SquiffyInitOptions> = {}) => {
    const element = document.getElementById("squiffy")!;
    const result = await squiffyCompile({ script });
    if (!result.success) throw new Error("Compile failed");
    const js = result.output.js.map(lines => new Function("squiffy", "get", "set", lines.join("\n")));
    const api = await init({ element, story: { js: js as any, ...result.output.story }, persist: false, scroll: "none", ...options });
    await api.begin();
    return { api, element };
};

const link = (element: HTMLElement, text: string) =>
    [...element.querySelectorAll<HTMLElement>("a.squiffy-link")].filter(l => l.textContent === text).pop()!;

const click = async (api: SquiffyApi, element: HTMLElement, text: string) => {
    expect(await api.clickLink(link(element, text))).toBe(true);
    await settle();
};

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const confirmDialogElement = () => document.querySelector<HTMLDialogElement>("dialog.squiffy-confirm");

test("{{restart}} and {{saves}} are links, with their own text or the page's", async () => {
    const { api, element } = await start({ strings: { restart: "Recommencer", saves: "Parties" } });
    await click(api, element, "Next");
    const links = [...element.querySelectorAll<HTMLElement>(".link-restart, .link-saves")];
    expect(links.map(l => l.textContent)).toEqual(["Play again", "Recommencer", "Parties", "Save your game"]);
    expect(links[0].getAttribute("data-confirm")).toBeNull();
    expect(links[1].getAttribute("data-confirm")).toBe("false");
});

test("{{restart}} asks first, in a dialog, and restarts only if the player says so", async () => {
    const { api, element } = await start();
    await click(api, element, "Next");

    await click(api, element, "Play again");
    let dialog = confirmDialogElement()!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector("p")!.textContent).toBe("Are you sure you want to restart?");
    dialog.querySelector<HTMLButtonElement>("[data-answer=no]")!.click();
    await settle();
    expect(confirmDialogElement()).toBeNull();
    expect(api.get("_section")).toBe("end");

    await click(api, element, "Play again");
    dialog = confirmDialogElement()!;
    dialog.querySelector<HTMLButtonElement>("[data-answer=yes]")!.click();
    await settle();
    expect(confirmDialogElement()).toBeNull();
    expect(api.get("_section")).toBe("start");
    expect(element.textContent).not.toContain("The end.");
});

test("{{restart confirm=false}} restarts straight away", async () => {
    const { api, element } = await start();
    await click(api, element, "Next");
    await click(api, element, "Restart");
    expect(confirmDialogElement()).toBeNull();
    expect(api.get("_section")).toBe("start");
});

test("{{saves}} opens a Saved games dialog", async () => {
    const { api, element } = await start();
    await click(api, element, "Next");
    await click(api, element, "Saved games");
    const dialogs = document.querySelectorAll<HTMLDialogElement>("dialog.squiffy-saves");
    expect(dialogs.length).toBe(1);
    expect(dialogs[0].open).toBe(true);
    dialogs[0].close();
    // The same dialog again
    await click(api, element, "Save your game");
    expect(document.querySelectorAll("dialog.squiffy-saves").length).toBe(1);
    expect(dialogs[0].open).toBe(true);
    api.dispose();
    expect(document.querySelectorAll("dialog.squiffy-saves").length).toBe(0);
});

test("The page can handle {{restart}} and {{saves}} itself", async () => {
    const { api, element } = await start();
    const restarts: boolean[] = [];
    let saves = 0;
    api.on("restartRequested", e => restarts.push(e.confirm));
    api.on("savesRequested", () => saves++);
    await click(api, element, "Next");
    await click(api, element, "Play again");
    await click(api, element, "Restart");
    await click(api, element, "Saved games");
    expect(restarts).toEqual([true, false]);
    expect(saves).toBe(1);
    expect(document.querySelector("dialog")).toBeNull();
    expect(api.get("_section")).toBe("end");
});

test("The links are only clickable in the current section", async () => {
    const twoEndings = `[[a]]:
{{restart confirm=false}} [[b]]

[[b]]:
B`;
    const element = document.getElementById("squiffy")!;
    const result = await squiffyCompile({ script: twoEndings });
    if (!result.success) throw new Error("Compile failed");
    const api = await init({ element, story: { js: [], ...result.output.story }, persist: false, scroll: "none" });
    await api.begin();
    await click(api, element, "b");
    expect(await api.clickLink(link(element, "Restart"))).toBe(false);
});

test("confirmDialog resolves false on Escape, and uses the given text", async () => {
    const answer = confirmDialog({ message: "Delete it?", confirm: "Delete", cancel: "Keep", danger: true });
    const dialog = confirmDialogElement()!;
    expect(dialog.getAttribute("role")).toBe("alertdialog");
    expect([...dialog.querySelectorAll("button")].map(b => b.textContent)).toEqual(["Keep", "Delete"]);
    expect(dialog.querySelector("[data-answer=yes]")!.classList.contains("squiffy-confirm-danger")).toBe(true);
    expect(document.activeElement).toBe(dialog.querySelector("[data-answer=yes]"));
    dialog.dispatchEvent(new window.Event("cancel", { cancelable: true }));
    expect(await answer).toBe(false);
    expect(confirmDialogElement()).toBeNull();
});
