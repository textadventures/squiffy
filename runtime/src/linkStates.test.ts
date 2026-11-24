import { expect, test, beforeEach, afterEach, beforeAll, vi } from "vitest";
import globalJsdom from "global-jsdom";
import { init } from "./squiffy.runtime.js";
import { compile as squiffyCompile } from "squiffy-compiler";
import type { SquiffyApi, SquiffyInitOptions } from "./types.js";

// Links for keyboard and screen reader users: the ones that can't be clicked any more are out of
// the Tab order and aria-disabled, and the focus moves to the text a link shows

beforeAll(() => {
    vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-0000-0000-000000000000" });
});

let cleanup: () => void;

beforeEach(() => {
    cleanup = globalJsdom("<!DOCTYPE html><html><body><button id=\"outside\">Outside</button><div id=\"squiffy\"></div></body></html>");
});

afterEach(() => {
    localStorage.clear();
    cleanup();
});

const script = `[[start]]:
You're in a room. [Look around], or go [[outside]].

[Look around]:
There's a [chair] here.

[chair]:
It's comfy.

[[outside]]:
You're outside. {{rotate (array "sunny" "cloudy")}}. Go [[back inside]](start), or [[wait]].

[[wait]]:
You wait. {{goto "later" after=10}}

[[later]]:
Later.`;

const start = async (options: Partial<SquiffyInitOptions> = {}, story = script) => {
    const element = document.getElementById("squiffy")!;
    const result = await squiffyCompile({ script: story });
    if (!result.success) throw new Error("Compile failed");
    const js = result.output.js.map(lines => new Function("squiffy", "get", "set", lines.join("\n")));
    const api = await init({ element, story: { js: js as any, ...result.output.story }, persist: false, scroll: "none", ...options });
    await api.begin();
    return { api, element };
};

const links = (element: HTMLElement, text: string) =>
    [...element.querySelectorAll<HTMLElement>("a.squiffy-link")].filter(l => l.textContent === text);

const link = (element: HTMLElement, text: string) => links(element, text).pop()!;

// Clicks a link as a keyboard user would: it has the focus first
const click = async (api: SquiffyApi, element: HTMLElement, text: string) => {
    const l = link(element, text);
    l.focus();
    expect(await api.clickLink(l)).toBe(true);
};

const reachable = (l: HTMLElement) => l.getAttribute("tabindex") === "0" && !l.hasAttribute("aria-disabled");
const unreachable = (l: HTMLElement) => l.getAttribute("tabindex") === "-1" && l.getAttribute("aria-disabled") === "true";

test("the links that can be clicked can be reached with Tab", async () => {
    const { element } = await start();
    expect(reachable(link(element, "Look around"))).toBe(true);
    expect(reachable(link(element, "outside"))).toBe(true);
});

test("a passage link that was clicked is aria-disabled and out of the Tab order", async () => {
    const { api, element } = await start();
    await click(api, element, "Look around");
    expect(unreachable(link(element, "Look around"))).toBe(true);
    expect(reachable(link(element, "outside"))).toBe(true);
    expect(reachable(link(element, "chair"))).toBe(true);
});

test("the links in a section the player has left are aria-disabled and out of the Tab order", async () => {
    const { api, element } = await start();
    await click(api, element, "outside");
    expect(unreachable(link(element, "Look around"))).toBe(true);
    expect(unreachable(link(element, "outside"))).toBe(true);
    expect(reachable(link(element, "back inside"))).toBe(true);
});

test("a {{rotate}} link can be reached with Tab", async () => {
    const { api, element } = await start();
    await click(api, element, "outside");
    expect(reachable(link(element, "sunny"))).toBe(true);
});

test("going back makes the links clickable again, and reachable with Tab", async () => {
    const { api, element } = await start();
    await click(api, element, "Look around");
    await click(api, element, "outside");
    api.goBack();
    expect(reachable(link(element, "outside"))).toBe(true);
    expect(reachable(link(element, "chair"))).toBe(true);
    expect(unreachable(link(element, "Look around"))).toBe(true);
    api.goBack();
    expect(reachable(link(element, "Look around"))).toBe(true);
});

test("clicking a passage link moves the focus to the passage's text", async () => {
    const { api, element } = await start();
    await click(api, element, "Look around");
    const passage = element.querySelector<HTMLElement>(".squiffy-output-passage[data-passage='Look around']")!;
    expect(document.activeElement).toBe(passage);
    expect(passage.getAttribute("tabindex")).toBe("-1");
});

test("clicking a section link moves the focus to the section's text", async () => {
    const { api, element } = await start();
    await click(api, element, "outside");
    expect(document.activeElement).toBe(element.querySelector(".squiffy-output-section[data-section='outside']"));
});

test("the text loses its tabindex when it loses the focus", async () => {
    const { api, element } = await start();
    await click(api, element, "outside");
    const section = element.querySelector<HTMLElement>(".squiffy-output-section[data-section='outside']")!;
    link(element, "back inside").focus();
    expect(section.hasAttribute("tabindex")).toBe(false);
    expect(section.classList.contains("squiffy-focus-target")).toBe(false);
});

test("the tabindex of the text that has the focus isn't saved", async () => {
    const { api, element } = await start({ persist: true, storyId: "links" });
    await click(api, element, "Look around");
    // Clicked without the link taking the focus, so the passage still has it when the game is saved
    expect(await api.clickLink(link(element, "outside"))).toBe(true);
    expect(document.activeElement?.getAttribute("data-section")).toBe("outside");
    const saved = JSON.parse(localStorage.getItem("links-_output")!) as string;
    expect(saved).not.toContain("squiffy-focus-target");
    expect(saved).not.toMatch(/<div class="squiffy-output-passage"[^>]*tabindex/);
});

test("a {{goto after=}} moves the focus to where it goes", async () => {
    const { api, element } = await start();
    await click(api, element, "outside");
    await click(api, element, "wait");
    await vi.waitFor(() => expect(api.get("_section")).toBe("later"));
    await vi.waitFor(() => expect(document.activeElement).toBe(element.querySelector(".squiffy-output-section[data-section='later']")));
});

test("a {{goto after=}} doesn't take the focus from outside the story", async () => {
    const { api, element } = await start();
    await click(api, element, "outside");
    await click(api, element, "wait");
    const outside = document.getElementById("outside")!;
    outside.focus();
    await vi.waitFor(() => expect(api.get("_section")).toBe("later"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(outside);
});

test("a saved game's links are brought up to date when it's loaded", async () => {
    const first = await start({ persist: true, storyId: "links" });
    await click(first.api, first.element, "outside");
    // As a game saved by an earlier version would be, with no link marked
    const saved = JSON.parse(localStorage.getItem("links-_output")!) as string;
    localStorage.setItem("links-_output", JSON.stringify(saved.replace(/ (tabindex|aria-disabled)="[^"]*"/g, "")));
    first.element.innerHTML = "";
    const { element } = await start({ persist: true, storyId: "links" });
    expect(unreachable(link(element, "outside"))).toBe(true);
    expect(reachable(link(element, "back inside"))).toBe(true);
});

// A section with @clear hides the link that was clicked. VoiceOver then moves the focus somewhere
// else, such as the header's dark mode button, which the section's JavaScript does here.
const clearing = `[[start]]:
Start. [[Go on]](next)

[[next]]:
@clear
    document.getElementById("outside").focus();
Next. [[Finish]](end)

[[end]]:
@clear
The end.`;

test("the story holds the focus while the screen is cleared, and then gives it to the new text", async () => {
    const { api, element } = await start({}, clearing.replace(/\n {4}document.*\n/, "\n"));
    const focused: Element[] = [];
    document.addEventListener("focusin", event => focused.push(event.target as Element));
    await click(api, element, "Go on");
    expect(focused.slice(1)).toEqual([element, element.querySelector(".squiffy-output-section[data-section='next']")]);
    expect(element.hasAttribute("tabindex")).toBe(false);
});

test("the focus goes to the new text even if something else took it while the screen was cleared", async () => {
    const { api, element } = await start({}, clearing);
    await click(api, element, "Go on");
    expect(document.activeElement).toBe(element.querySelector(".squiffy-output-section[data-section='next']"));
});

test("the focus stays outside the story if the link was clicked while it was there", async () => {
    const { api, element } = await start({}, clearing);
    const outside = document.getElementById("outside")!;
    outside.focus();
    expect(await api.clickLink(link(element, "Go on"))).toBe(true);
    expect(document.activeElement).toBe(outside);
});
