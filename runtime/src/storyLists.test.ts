// Listing a story's sections and passages, and their @tag tags (#527): the passages, sections
// and tags helpers, and squiffy.story.passages(), sections() and tags() in JavaScript
import { expect, test, beforeEach, afterEach, vi } from "vitest";
import globalJsdom from "global-jsdom";
import { init } from "./squiffy.runtime.js";
import { compile as squiffyCompile } from "squiffy-compiler";

let cleanup: () => void;

beforeEach(() => {
    cleanup = globalJsdom("<!DOCTYPE html><html><body><div id=\"squiffy\"></div></body></html>");
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    cleanup();
});

const start = async (script: string) => {
    const result = await squiffyCompile({ script });
    if (!result.success) throw new Error("Compile failed: " + JSON.stringify(result.errors));
    const story = {
        ...result.output.story,
        js: result.output.js.map(lines => new Function("squiffy", "get", "set", lines.join("\n"))) as any,
    };
    const element = document.getElementById("squiffy")!;
    const api = await init({ element, story, persist: false, storyId: "test", scroll: "none" });
    await api.begin();
    await vi.runAllTimersAsync();
    return { api, element };
};

const text = (element: HTMLElement) => element.textContent!.replace(/\s+/g, " ").trim();

// The story the passengers are in, from Moquette, where the issue came from
const passengers = `
[[]]:

[a man (Kurt Cobain)]:
@tag passenger
A man.

[a woman and child]:
@tag passenger settled
A woman and child.

[a busker]:
@tag passenger
A busker.

[@last]:
The end of the line.

[[carriage]]:
@tag train
CONTENT

[a newspaper]:
A newspaper.

[]:
Every passage.

[@1]:
Once.

[[platform]]:
@tag station underground
The platform.
`;

const story = (content: string) => passengers.replace("CONTENT", content);

test("passages lists the current section's passages and the master section's, without the special ones", async () => {
    const { element } = await start(story("{{join (passages) \" / \"}}"));
    expect(text(element)).toBe("a newspaper / a man (Kurt Cobain) / a woman and child / a busker");
});

test("passages lists a section's passages, with \"\" for the master section", async () => {
    const { element } = await start(story("{{join (passages \"carriage\")}} | {{join (passages \"\")}} | {{length (passages \"platform\")}}"));
    expect(text(element)).toBe("a newspaper | a man (Kurt Cobain), a woman and child, a busker | 0");
});

test("passages tagged= and untagged= choose by tag", async () => {
    const { element } = await start(story("{{join (passages tagged=\"passenger\" untagged=\"settled\")}}. {{join (passages tagged=\"passenger settled\")}}."));
    expect(text(element)).toBe("a man (Kurt Cobain), a busker. a woman and child.");
});

test("passages gives a list to choose a passage from, which links to it", async () => {
    const { element } = await start(story("{{#each (passages tagged=\"passenger\")}}{{passage this}} {{/each}}"));
    const link = [...element.querySelectorAll<HTMLElement>("a.squiffy-link")].find(l => l.textContent == "a busker")!;
    link.click();
    await vi.runAllTimersAsync();
    expect(text(element)).toContain("A busker.");
});

test("random chooses from the list", async () => {
    const { element } = await start(story("{{random (passages tagged=\"passenger\" untagged=\"settled\")}}"));
    expect(["a man (Kurt Cobain)", "a busker"]).toContain(text(element));
});

test("sections lists the story's sections, apart from the master section", async () => {
    const { element } = await start(story("{{join (sections)}}. {{join (sections tagged=\"station\")}}. {{join (sections untagged=\"train\")}}."));
    expect(text(element)).toBe("carriage, platform. platform. platform.");
});

test("tags gives a passage's or section's tags, or the current section's", async () => {
    const { element } = await start(story("{{join (tags)}}. {{join (tags \"a woman and child\")}}. {{join (tags \"platform\")}}. {{#if (contains (tags \"a busker\") \"settled\")}}settled{{else}}not settled{{/if}}. {{#if (tags \"a woman and child\") contains \"settled\"}}settled{{/if}}."));
    expect(text(element)).toBe("train. passenger, settled. station, underground. not settled. settled.");
});

test("an attribute with the same name is still shown", async () => {
    const { element } = await start(story("@set tags = mine\n{{tags}} {{join (tags \"platform\")}}"));
    expect(text(element)).toBe("mine station, underground");
});

test("a section that doesn't exist is an error", async () => {
    const { element } = await start(story("{{passages \"nowhere\"}}"));
    expect(text(element)).toContain("There's no section called \"nowhere\"");
});

test("squiffy.story.passages, sections and tags in JavaScript", async () => {
    const { element } = await start(story(`    var s = squiffy.story;
    set("result", [
        s.passages().length,
        s.passages("", { tagged: "passenger", untagged: ["settled"] }).join("/"),
        s.sections({ tagged: "underground" }).join("/"),
        s.tags().join("/"),
        s.tags("a woman and child").join("/"),
    ].join(" | "));
{{result}}`));
    expect(text(element)).toBe("4 | a man (Kurt Cobain)/a busker | platform | train | passenger/settled");
});
