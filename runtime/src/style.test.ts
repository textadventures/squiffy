// {{#style}} (#453): gives some text a class, for the story's CSS or the built-in effects
import { expect, test, beforeEach, afterEach } from "vitest";
import globalJsdom from "global-jsdom";
import { init } from "./squiffy.runtime.js";
import { compile as squiffyCompile } from "squiffy-compiler";

let cleanup: () => void;

beforeEach(() => {
    cleanup = globalJsdom("<!DOCTYPE html><html><body><div id=\"squiffy\"></div></body></html>");
});

afterEach(() => {
    localStorage.clear();
    cleanup();
});

const start = async (script: string) => {
    const result = await squiffyCompile({ script });
    if (!result.success) throw new Error("Compile failed");
    const story = {
        ...result.output.story,
        js: result.output.js.map(lines => new Function("squiffy", "get", "set", lines.join("\n"))) as any,
    };
    const element = document.getElementById("squiffy")!;
    const api = await init({ element, story, persist: false, storyId: "test", scroll: "none" });
    await api.begin();
    return element;
};

test("{{#style}} wraps inline text in a span with the class", async () => {
    const element = await start("A {{#style \"warning\"}}**loud** noise{{/style}} here.");
    const span = element.querySelector(".squiffy-style")!;
    expect(span.tagName).toBe("SPAN");
    expect([...span.classList]).toEqual(["squiffy-style", "warning"]);
    expect(span.innerHTML).toBe("<strong>loud</strong> noise");
    expect(span.closest("p")?.textContent).toBe("A loud noise here.");
});

test("{{#style}} takes several classes, from strings or attributes", async () => {
    const element = await start(`@set mood = gloomy
{{#style "big shudder" mood}}Text{{/style}}`);
    expect([...element.querySelector(".squiffy-style")!.classList]).toEqual(["squiffy-style", "big", "shudder", "gloomy"]);
});

test("{{#style}} puts each effect after the first on an element of its own, so they all apply", async () => {
    const element = await start("{{#style \"big shudder fade-in-out mirror\"}}**Text**{{/style}}");
    const p = element.querySelector(".squiffy-output-block p")!;
    expect(p.innerHTML).toBe("<span class=\"squiffy-style big shudder\"><span class=\"squiffy-style fade-in-out\">"
        + "<span class=\"squiffy-style mirror\"><strong>Text</strong></span></span></span>");
});

test("{{#style}} nests divs for several effects around paragraphs", async () => {
    const element = await start("{{#style \"letter sway blur\"}}\nDear *you*,\n\nGoodbye.\n{{/style}}");
    const outer = element.querySelector(".squiffy-style")!;
    expect(outer.tagName).toBe("DIV");
    expect([...outer.classList]).toEqual(["squiffy-style", "letter", "sway"]);
    const inner = outer.querySelector(":scope > .squiffy-style")!;
    expect(inner.tagName).toBe("DIV");
    expect([...inner.classList]).toEqual(["squiffy-style", "blur"]);
    expect([...inner.querySelectorAll("p")].map(p => p.innerHTML)).toEqual(["Dear <em>you</em>,", "Goodbye."]);
});

test("{{#style}} around paragraphs makes a div, with Markdown rendered inside", async () => {
    const element = await start(`{{#style "letter"}}
Dear *you*,

Goodbye.
{{/style}}`);
    const div = element.querySelector(".squiffy-style")!;
    expect(div.tagName).toBe("DIV");
    expect(div.classList.contains("letter")).toBe(true);
    expect([...div.querySelectorAll("p")].map(p => p.innerHTML)).toEqual(["Dear <em>you</em>,", "Goodbye."]);
});

test("{{#style}} escapes the class names, and shows helpers inside it", async () => {
    const element = await start(`@set name = Ann
{{#style "a\\"b"}}Hi {{name}}{{/style}}`);
    const span = element.querySelector(".squiffy-style")!;
    expect(span.getAttribute("class")).toBe("squiffy-style a\"b");
    expect(span.textContent).toBe("Hi Ann");
});
