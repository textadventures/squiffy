import { readFileSync } from "fs";
import { expect, test, vi } from "vitest";
import { parseProjectFile } from "squiffy-compiler";

vi.mock("vscode", () => ({}));
const { MAIN_FILE, NEW_STORY, newStoryFiles } = await import("./new-story.js");
const { fileName } = await import("./export.js");

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
