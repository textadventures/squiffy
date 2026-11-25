import { readFileSync } from "fs";
import { expect, test, vi } from "vitest";
import { parseProjectFile } from "squiffy-compiler";

vi.mock("vscode", () => ({}));
const { MAIN_FILE, NEW_STORY, newStoryFiles, passageHasSection } = await import("./new-story.js");
const { clashMessage, fileName } = await import("./export.js");

// The editor's new story, read from its source: importing it would need the app's tsconfig
const source = readFileSync(new URL("../../../app/src/lib/project.svelte.ts", import.meta.url), "utf8");
const editorNewStory = /export const NEW_STORY = `([\s\S]*?)`;/.exec(source)![1];

test("the new story is the editor's", () => {
    expect(NEW_STORY).toBe(editorNewStory);
});

test("a new story has its title and a squiffy.json naming its main file", () => {
    const files = newStoryFiles("  The   Cave ");
    expect(files[MAIN_FILE]).toMatch(/^@title The Cave\n/);
    const project = parseProjectFile(files["squiffy.json"]);
    expect(project.success && project.project).toMatchObject({ version: 1, main: MAIN_FILE });
    expect(project.success && project.project.language).toBeUndefined();
});

test("a new story has VS Code's language", () => {
    const project = parseProjectFile(newStoryFiles("The Cave", "pt-br")["squiffy.json"]);
    expect(project.success && project.project.language).toBe("pt-BR");
});

test("a title with $ in it is kept as it is", () => {
    expect(newStoryFiles("$& money")[MAIN_FILE]).toMatch(/^@title \$& money\n/);
});

test("an export's file name comes from the story's title", () => {
    expect(fileName("The Cave: Part 1?", ".zip")).toBe("The Cave Part 1.zip");
    expect(fileName(undefined, ".zip")).toBe("story.zip");
});

test("a passage needs a section above it to belong to", () => {
    const lines = ["@title Story", "@start a", "", "Opening text.", "", "[[a]]:", "@end", "A."];
    // On @title or @start, above everything, it would take the opening text for its own
    expect(passageHasSection(lines, 0)).toBe(false);
    expect(passageHasSection(lines, 1)).toBe(false);
    expect(passageHasSection(lines, 2)).toBe(false);
    // After the opening text, it belongs to the start of the story
    expect(passageHasSection(lines, 3)).toBe(true);
    expect(passageHasSection(lines, 6)).toBe(true);
    // A file that starts with a section
    expect(passageHasSection(["[[b]]:", "B."], 0)).toBe(true);
    expect(passageHasSection(["+++Next"], 0)).toBe(true);
    // A passage header above isn't a section of its own
    expect(passageHasSection(["@title x", "[p]:"], 1)).toBe(false);
});

test("an export that would replace files names them", () => {
    expect(clashMessage(["story.js"])).toBe("story.js");
    expect(clashMessage(["style.css", "index.html"])).toBe("index.html and style.css");
    expect(clashMessage(["style.css", "index.html", "story.js", "squiffy.runtime.global.js"])).toBe("index.html, squiffy.runtime.global.js, story.js and style.css");
    expect(clashMessage(["e", "d", "c", "b", "a"])).toBe("a, b, c and 2 other files");
});
