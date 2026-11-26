import { expect, test, beforeEach, afterEach } from "vitest";
import globalJsdom from "global-jsdom";
import { init } from "./squiffy.runtime.js";
import { compile } from "squiffy-compiler";

// showUnsetNames (#712): in the author's testing views, a bare {{name}} that isn't set shows as a
// faint {{name}} in the text, and is nothing everywhere else, as it always is in a published story

let cleanup: () => void;

beforeEach(() => {
    cleanup = globalJsdom("<!DOCTYPE html><html><body><div id=\"squiffy\"></div></body></html>");
});

afterEach(() => {
    localStorage.clear();
    cleanup();
});

const start = async (script: string, showUnsetNames = true, expressions = false) => {
    const result = await compile({ script, expressions });
    if (!result.success) throw new Error("Compile failed: " + JSON.stringify(result.errors));
    const js = result.output.js.map(lines => new Function("squiffy", "get", "set", lines.join("\n")));
    const element = document.getElementById("squiffy")!;
    const squiffyApi = await init({ element, story: { ...result.output.story, js: js as any }, showUnsetNames });
    await squiffyApi.begin();
    return { squiffyApi, element };
};

const lastSection = (element: HTMLElement) => {
    const sections = element.querySelectorAll(".squiffy-output-section");
    return sections[sections.length - 1] as HTMLElement;
};

test("Off, an unset {{name}} shows nothing, as before", async () => {
    const { element } = await start("Loot: {{loot}}.", false);
    expect(lastSection(element).textContent?.trim()).toBe("Loot: .");
    expect(element.querySelector(".squiffy-unset")).toBeNull();
});

test("On, an unset {{name}} shows as a faint {{name}}", async () => {
    const { element } = await start("Loot: {{loot}}, and {{{gold}}}.");
    expect(lastSection(element).textContent?.trim()).toBe("Loot: {{loot}}, and {{gold}}.");
    const spans = element.querySelectorAll<HTMLElement>(".squiffy-unset");
    expect(spans).toHaveLength(2);
    expect(spans[0].textContent).toBe("{{loot}}");
    expect(spans[0].title).toBe("loot isn't set");
    expect(spans[1].textContent).toBe("{{gold}}");
});

test("An attribute set to nothing or 0 shows its value", async () => {
    const { element } = await start(`@set empty = ""
@set zero = 0
({{empty}}) ({{zero}})`, true, true);
    expect(lastSection(element).textContent?.trim()).toBe("() (0)");
    expect(element.querySelector(".squiffy-unset")).toBeNull();
});

test("Helpers and attributes still show as before", async () => {
    const { element } = await start(`@set loot = gold
{{loot}} {{seen "nowhere"}} {{upper "x"}}`);
    expect(lastSection(element).textContent?.trim()).toBe("gold false X");
    expect(element.querySelector(".squiffy-unset")).toBeNull();
});

test("Inside an {{#each}}, an unset name shows, and the item's own names as before", async () => {
    const { element } = await start(`@set items = @array
{{append "items" "lamp"}}{{#each items}}{{this}} and {{missing}}{{/each}}`);
    expect(lastSection(element).textContent?.trim()).toBe("lamp and {{missing}}");
});

test("Inside an embed, its parameters show, and an unset name shows", async () => {
    const { element } = await start(`[[section1]]:
{{embed "say" who="Ann"}}

[[say]]:
{{who}} has {{loot}}.`);
    expect(lastSection(element).textContent?.trim()).toBe("Ann has {{loot}}.");
    expect(element.querySelectorAll(".squiffy-unset")).toHaveLength(1);
});

test("In an attribute, a link's setters or a := setter, an unset name is nothing", async () => {
    const { squiffyApi, element } = await start(`[[section1]]:
@set greeting := Hi {{who}}!
<img src="{{pic}}.png" title="{{caption}}"> [[Take the {{item}}]](next, taken = "{{item}}")

[[next]]:
Done.`, true, true);
    const img = element.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(".png");
    expect(img.getAttribute("title")).toBe("");
    expect(squiffyApi.get("greeting")).toBe("Hi !");

    const link = element.querySelector<HTMLElement>("a.link-section")!;
    expect(link.textContent).toBe("Take the {{item}}");
    expect(link.dataset.section).toBe("next");
    expect(link.dataset.set).toBe(JSON.stringify(['taken = ""']));
    expect(element.innerHTML).not.toMatch(/[\uE000\uE001]/);

    await squiffyApi.clickLink(link);
    expect(squiffyApi.get("taken")).toBe("");
    expect(squiffyApi.get("_section")).toBe("next");
});

test("With expressions, a := setter's text has nothing for an unset name", async () => {
    const { squiffyApi } = await start(`@set greeting := Hi {{who}}!
Text.`, true, true);
    expect(squiffyApi.get("greeting")).toBe("Hi !");
});

test("A missing helper given values is still an error", async () => {
    const { element } = await start("{{nosuchhelper 1}}");
    expect(element.querySelector(".squiffy-error")?.textContent).toContain("Missing helper");
});
