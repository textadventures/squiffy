import { expect, test, beforeEach, afterEach } from "vitest";
import globalJsdom from "global-jsdom";
import { init } from "./squiffy.runtime.js";
import { compile as squiffyCompile, PANEL_ICONS as COMPILER_PANEL_ICONS } from "squiffy-compiler";
import { createPanels } from "./panels.js";
import { PANEL_ICONS, type Panel, type SquiffyApi } from "./types.js";

let cleanup: () => void;

beforeEach(() => {
    cleanup = globalJsdom("<!DOCTYPE html><html><body><div id=\"container\"><div id=\"header\"><button id=\"restart\"></button></div><div id=\"squiffy\"></div></div></body></html>");
    // jsdom has no showModal()
    window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    window.HTMLDialogElement.prototype.close = function () {
        this.removeAttribute("open");
        this.dispatchEvent(new window.Event("close"));
    };
});

afterEach(() => {
    cleanup();
});

const script = `[[]]:

[status]:
Gold: {{gold}}

[lamp]:
{{#if lamp}}You have a lamp.{{/if}}

[inventory]:
{{#if lamp}}You have a lamp.{{/if}}{{set "gold" 1000}}{{goto "end"}} Go to [[end]] or [here](b).

[[start]]:
@set gold = 5
Welcome. [Get the lamp](b, lamp, gold += 10) or go to [[end]].

[b]:
You have it.

[[end]]:
The end.`;

const start = async () => {
    const element = document.getElementById("squiffy")!;
    const result = await squiffyCompile({ script });
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

// Lets the panels' queued refresh happen
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const panelsFor = (api: SquiffyApi, panels: Panel[]) => createPanels(api, {
    panels,
    buttons: document.getElementById("header")!,
    side: document.getElementById("container")!,
});

test("renderPassage renders a master section passage with the attributes as they are", async () => {
    const { api } = await start();
    expect(api.renderPassage("status")).toBe("<p>Gold: 5</p>");
});

test("renderPassage changes nothing, and disables its links", async () => {
    const { api, element } = await start();
    const html = api.renderPassage("inventory");
    expect(api.get("gold")).toBe(5);
    expect(api.get("_section")).toBe("start");
    expect(html).toContain("class=\"squiffy-link link-section disabled\"");
    expect(html).toContain("class=\"squiffy-link link-passage disabled\"");
    // Its {{goto}} isn't followed when the story moves on
    await click(api, element, "Get the lamp");
    expect(api.get("_section")).toBe("start");
    expect(api.get("gold")).toBe(15);
});

test("renderPassage shows an error for a passage that isn't in the master section", async () => {
    const { api } = await start();
    expect(api.renderPassage("b")).toContain("there is no passage called \"b\" in the master section [[]]");
});

test("a side panel is shown beside the story, and rendered again as the story goes on", async () => {
    const { api, element } = await start();
    panelsFor(api, [{ passage: "status", label: "Status", position: "side" }]);
    const container = document.getElementById("container")!;
    expect(container.classList.contains("squiffy-has-side")).toBe(true);
    const panel = container.querySelector("aside.squiffy-panels-side > section.squiffy-panel")!;
    expect(panel.getAttribute("aria-label")).toBe("Status");
    expect(panel.innerHTML).toBe("<p>Gold: 5</p>");

    await click(api, element, "Get the lamp");
    await settle();
    expect(panel.innerHTML).toBe("<p>Gold: 15</p>");

    api.goBack();
    await settle();
    expect(panel.innerHTML).toBe("<p>Gold: 5</p>");

    // Its button is for narrow screens, where CSS hides the panel
    const button = document.querySelector<HTMLButtonElement>("#header button.squiffy-panel-button")!;
    expect(button.classList.contains("squiffy-panel-side-button")).toBe(true);
});

test("a side panel whose text comes out empty is hidden", async () => {
    const { api, element } = await start();
    panelsFor(api, [{ passage: "lamp", label: "Lamp", position: "side" }]);
    const aside = document.querySelector<HTMLElement>("aside.squiffy-panels-side")!;
    const section = aside.querySelector<HTMLElement>("section")!;
    expect(section.hidden).toBe(true);
    expect(aside.hidden).toBe(true);
    await click(api, element, "Get the lamp");
    await settle();
    expect(section.hidden).toBe(false);
    expect(aside.hidden).toBe(false);
});

test("a button panel's button opens it in a dialog, rendered fresh", async () => {
    const { api, element } = await start();
    panelsFor(api, [{ passage: "status", label: "Status" }, { passage: "inventory", label: "Bag", icon: "bag" }]);
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("#header button")];
    // Before the page's own buttons, in the order they're listed
    expect(buttons.map(b => b.id || b.dataset.passage)).toEqual(["status", "inventory", "restart"]);
    expect(buttons[0].textContent).toBe("Status");
    expect(buttons[0].classList.contains("squiffy-panel-text-button")).toBe(true);
    expect(buttons[1].getAttribute("aria-label")).toBe("Bag");
    expect(buttons[1].querySelector("svg")).not.toBeNull();
    // No side panels, so no aside
    expect(document.querySelector("aside")).toBeNull();

    buttons[0].click();
    const dialog = document.querySelector<HTMLDialogElement>("dialog.squiffy-panel-dialog")!;
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.querySelector("h2")!.textContent).toBe("Status");
    expect(dialog.querySelector(".squiffy-panel-dialog-content")!.innerHTML).toBe("<p>Gold: 5</p>");
    // The story's text isn't touched
    expect(element.textContent).not.toContain("Gold:");

    // While it's open, it follows the story
    api.set("gold", 7);
    await settle();
    expect(dialog.querySelector(".squiffy-panel-dialog-content")!.innerHTML).toBe("<p>Gold: 7</p>");

    dialog.querySelector<HTMLButtonElement>(".squiffy-panel-dialog-close")!.click();
    expect(dialog.hasAttribute("open")).toBe(false);
});

test("opening a panel doesn't count as a move", async () => {
    const { api } = await start();
    const panels = panelsFor(api, [{ passage: "status", label: "Status" }]);
    panels.open("status");
    expect(api.canGoBack()).toBe(false);
});

test("without a side element, a side panel only has its button", async () => {
    const { api } = await start();
    createPanels(api, { panels: [{ passage: "status", label: "Status", position: "side" }], buttons: document.getElementById("header")! });
    expect(document.querySelector("aside")).toBeNull();
    const button = document.querySelector<HTMLButtonElement>("button.squiffy-panel-button")!;
    expect(button.classList.contains("squiffy-panel-side-button")).toBe(false);
});

test("dispose takes the panels off the page", async () => {
    const { api } = await start();
    const panels = panelsFor(api, [{ passage: "status", label: "Status", position: "side" }, { passage: "inventory", label: "Bag" }]);
    panels.dispose();
    expect(document.querySelector("aside, dialog, button.squiffy-panel-button")).toBeNull();
    expect(document.getElementById("container")!.classList.contains("squiffy-has-side")).toBe(false);
    expect(document.getElementById("restart")).not.toBeNull();
});

test("the dialog's Close button can be translated", async () => {
    const { api } = await start();
    createPanels(api, { panels: [{ passage: "status", label: "État" }], buttons: document.getElementById("header")!, strings: { close: "Fermer" } });
    expect(document.querySelector(".squiffy-panel-dialog-close")!.getAttribute("aria-label")).toBe("Fermer");
});

test("a hot update renders the panels again", async () => {
    const { api } = await start();
    panelsFor(api, [{ passage: "status", label: "Status", position: "side" }]);
    const result = await squiffyCompile({ script: script.replace("Gold: {{gold}}", "Coins: {{gold}}") });
    if (!result.success) throw new Error("Compile failed");
    const js = result.output.js.map(lines => new Function("squiffy", "get", "set", lines.join("\n")));
    api.update({ js: js as any, ...result.output.story });
    await settle();
    expect(document.querySelector("aside section")!.innerHTML).toBe("<p>Coins: 5</p>");
});

test("the compiler checks for the same icons the runtime has", () => {
    expect([...COMPILER_PANEL_ICONS]).toEqual([...PANEL_ICONS]);
});

test("shows the attributes of a game restored when the page loads", async () => {
    const element = document.getElementById("squiffy")!;
    const result = await squiffyCompile({ script });
    if (!result.success) throw new Error("Compile failed");
    const js = result.output.js.map(lines => new Function("squiffy", "get", "set", lines.join("\n")));
    const story = { js: js as any, ...result.output.story };

    const first = await init({ element, story, persist: true, storyId: "panels-restore" });
    await first.begin();
    await click(first, element, "Get the lamp");
    expect(first.get("gold")).toBe(15);

    // The page again, as it does it: the panels first, then the story begins, from the saved game
    document.getElementById("container")!.querySelector("aside")?.remove();
    element.innerHTML = "";
    const api = await init({ element, story, persist: true, storyId: "panels-restore" });
    panelsFor(api, [{ passage: "status", label: "Status", position: "side" }]);
    await api.begin();
    await settle();

    expect(document.querySelector("aside.squiffy-panels-side")!.textContent).toContain("Gold: 15");
    localStorage.clear();
});
