import { expect, test, beforeEach, afterEach } from "vitest";
import globalJsdom from "global-jsdom";
import { init } from "./squiffy.runtime.js";
import { compile as squiffyCompile } from "squiffy-compiler";
import { createSettingsDialog } from "./settingsDialog.js";
import type { PlayerSetting, SquiffyInitOptions } from "./types.js";

// Player settings (#452): squiffy.json's "settings", which the story reads as settings.name

let cleanup: () => void;

beforeEach(() => {
    cleanup = globalJsdom("<!DOCTYPE html><html><body><div id=\"squiffy\"></div></body></html>");
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

const SETTINGS: PlayerSetting[] = [
    { name: "warnings", label: "Content warnings", type: "toggle", default: true, description: "Before scenes some may find upsetting" },
    { name: "textSize", label: "Text size", type: "list", options: [
        { value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" },
    ], default: "medium" },
    { name: "speed", label: "Speed", type: "range", min: 1, max: 5, step: 1, default: 3 },
];

const script = `[[start]]:
@set score = 1
{{#if settings.warnings}}Warning!{{/if}} Size {{settings.textSize}}, speed {{settings.speed}}.
{{#if settings.textSize == "large"}}Big.{{/if}}
Live: {{live "settings.speed"}}
{{settings}} {{settings text="Options"}} [[Next]](end)

[[end]]:
@set score = 2
The end.`;

const start = async (options: Partial<SquiffyInitOptions> = {}, settings: PlayerSetting[] | undefined = SETTINGS) => {
    const element = document.getElementById("squiffy")!;
    const result = await squiffyCompile({ script, settings });
    if (!result.success) throw new Error("Compile failed");
    const js = result.output.js.map(lines => new Function("squiffy", "get", "set", lines.join("\n")));
    const api = await init({ element, story: { js: js as any, ...result.output.story }, persist: false, scroll: "none", ...options });
    await api.begin();
    return { api, element };
};

const link = (element: HTMLElement, text: string) =>
    [...element.querySelectorAll<HTMLElement>("a.squiffy-link")].filter(l => l.textContent === text).pop()!;

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const text = (element: HTMLElement) => element.textContent!.replace(/\s+/g, " ");

test("The story reads its settings' defaults as settings.name", async () => {
    const { api, element } = await start();
    expect(text(element)).toContain("Warning! Size medium, speed 3.");
    expect(text(element)).not.toContain("Big.");
    expect(api.get("settings")).toEqual({ warnings: true, textSize: "medium", speed: 3 });
    expect(api.get("settings.textSize")).toBe("medium");
    expect(api.getSettings().map(s => s.name)).toEqual(["warnings", "textSize", "speed"]);
});

test("Changed settings are read as the player left them, and only values a setting can have are taken", async () => {
    const { api, element } = await start();
    api.setSetting("warnings", false);
    api.setSetting("textSize", "large");
    api.setSetting("speed", 4.6);
    expect(api.get("settings")).toEqual({ warnings: false, textSize: "large", speed: 5 });

    api.setSetting("textSize", "enormous");
    api.setSetting("speed", "fast" as any);
    api.setSetting("nonsense", true);
    expect(api.get("settings")).toEqual({ warnings: false, textSize: "large", speed: 5 });

    // Text shown after the change uses it
    api.restart();
    await settle();
    expect(text(element)).toContain("Size large, speed 5.");
    expect(text(element)).toContain("Big.");
});

test("Settings put classes on the story's element, for its CSS", async () => {
    const { api, element } = await start();
    expect([...element.classList]).toEqual(expect.arrayContaining(["setting-warnings", "setting-textSize-medium", "setting-speed-3"]));
    api.setSetting("warnings", false);
    api.setSetting("textSize", "large");
    expect(element.classList.contains("setting-warnings")).toBe(false);
    expect(element.classList.contains("setting-textSize-medium")).toBe(false);
    expect(element.classList.contains("setting-textSize-large")).toBe(true);
});

test("The story can't change a setting", async () => {
    const { api } = await start();
    api.set("settings.warnings", false);
    api.set("settings", { warnings: false });
    expect(api.getSetting("warnings")).toBe(true);
});

test("Back, Restart and saved games leave settings alone, and saved games don't include them", async () => {
    const { api, element } = await start();
    const save = api.getSave();
    expect(save.state).not.toHaveProperty("settings");

    await api.clickLink(link(element, "Next"));
    api.setSetting("textSize", "small");
    api.goBack();
    expect(api.get("score")).toBe(1);
    expect(api.getSetting("textSize")).toBe("small");

    await api.loadSave(save);
    expect(api.getSetting("textSize")).toBe("small");

    api.restart();
    await settle();
    expect(api.getSetting("textSize")).toBe("small");
    expect(text(element)).toContain("Size small");
});

test("Settings are kept for the story when persist is on, and Reset to defaults puts them back", async () => {
    const first = await start({ persist: true, storyId: "mystory" });
    first.api.setSetting("speed", 2);
    first.api.dispose();
    document.getElementById("squiffy")!.innerHTML = "";

    const { api, element } = await start({ persist: true, storyId: "mystory" });
    expect(api.getSetting("speed")).toBe(2);
    expect(element.classList.contains("setting-speed-2")).toBe(true);

    const changes: unknown[] = [];
    api.on("settingChanged", e => changes.push(e));
    api.resetSettings();
    expect(api.getSetting("speed")).toBe(3);
    expect(changes).toEqual([{ name: "speed", value: 3 }]);
    expect(localStorage.getItem("squiffy-settings:mystory")).toBeNull();
});

test("A story without settings can have an attribute called settings", async () => {
    const { api } = await start({}, []);
    api.set("settings", { a: 1 });
    expect(api.get("settings.a")).toBe(1);
    expect(api.getSettings()).toEqual([]);
});

test("Changing a setting updates {{live}} text and raises settingChanged", async () => {
    const { api } = await start();
    const events: unknown[] = [];
    api.on("settingChanged", e => events.push(e));
    api.on("set", e => events.push(e.attribute));
    api.setSetting("warnings", false);
    api.setSetting("warnings", false);
    expect(events).toEqual([{ name: "warnings", value: false }, "settings"]);
});

test("{{live}} shows a setting as it changes, and only fades when its own value changes", async () => {
    const { api, element } = await start();
    const live = element.querySelector<HTMLElement>(".squiffy-live")!;
    expect(live.textContent).toBe("3");
    api.setSetting("warnings", false);
    expect(live.classList.contains("fade-out")).toBe(false);
    api.setSetting("speed", 4);
    expect(live.classList.contains("fade-out")).toBe(true);
});

const settingsDialog = () => document.querySelector<HTMLDialogElement>("dialog.squiffy-settings");

test("{{settings}} is a link that opens the runtime's own Settings dialog, if the page doesn't handle it", async () => {
    const { api, element } = await start({ strings: { settings: "Réglages" } });
    expect(link(element, "Réglages").classList.contains("link-settings")).toBe(true);
    expect(await api.clickLink(link(element, "Options"))).toBe(true);
    const dialog = settingsDialog()!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector("h2")!.textContent).toBe("Réglages");
    // The link can be clicked again
    expect(link(element, "Options").classList.contains("disabled")).toBe(false);
});

test("{{settings}} raises settingsRequested if the page handles it", async () => {
    const { api, element } = await start();
    let requested = 0;
    api.on("settingsRequested", () => requested++);
    await api.clickLink(link(element, "Options"));
    expect(requested).toBe(1);
    expect(settingsDialog()).toBeNull();
});

const dialogFor = async () => {
    const { api, element } = await start();
    const dialog = createSettingsDialog(api);
    dialog.open();
    return { api, element, dialog: dialog.element };
};

test("The Settings dialog shows each setting with its value", async () => {
    const { dialog } = await dialogFor();
    const rows = [...dialog.querySelectorAll(".squiffy-setting")];
    expect(rows.map(r => r.querySelector("label")!.textContent)).toEqual(["Content warnings", "Text size", "Speed"]);
    expect(rows[0].querySelector("p")!.textContent).toBe("Before scenes some may find upsetting");
    expect(rows[0].querySelector<HTMLInputElement>("input[type=checkbox]")!.checked).toBe(true);
    const select = rows[1].querySelector<HTMLSelectElement>("select")!;
    expect([...select.options].map(o => o.textContent)).toEqual(["Small", "Medium", "Large"]);
    expect(select.value).toBe("medium");
    expect(rows[2].querySelector<HTMLInputElement>("input[type=range]")!.value).toBe("3");
    expect(rows[2].querySelector("output")!.textContent).toBe("3");
});

test("Changing a control in the Settings dialog changes the setting straight away", async () => {
    const { api, element, dialog } = await dialogFor();
    const toggle = dialog.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    toggle.checked = false;
    toggle.dispatchEvent(new window.Event("change"));
    const select = dialog.querySelector<HTMLSelectElement>("select")!;
    select.value = "large";
    select.dispatchEvent(new window.Event("change"));
    const range = dialog.querySelector<HTMLInputElement>("input[type=range]")!;
    range.value = "5";
    range.dispatchEvent(new window.Event("input"));
    expect(api.get("settings")).toEqual({ warnings: false, textSize: "large", speed: 5 });
    expect(dialog.querySelector("output")!.textContent).toBe("5");
    expect(element.classList.contains("setting-textSize-large")).toBe(true);

    dialog.querySelector<HTMLButtonElement>("[data-reset]")!.click();
    expect(api.get("settings")).toEqual({ warnings: true, textSize: "medium", speed: 3 });
    expect(dialog.querySelector<HTMLSelectElement>("select")!.value).toBe("medium");
});
