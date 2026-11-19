import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { findStory, listSquiffyFiles, StoryNotFoundError } from "./node.js";

let dir: string;

beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "squiffy-node-")));
});

afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
});

const write = async (files: Record<string, string>) => {
    for (const [name, text] of Object.entries(files)) {
        await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
        await fs.writeFile(path.join(dir, name), text);
    }
};

const project = "{ \"version\": 1, \"main\": \"story.squiffy\", \"exclude\": [\"drafts/**\"] }";

describe("findStory", () => {
    test("a folder builds the project in its squiffy.json", async () => {
        await write({
            "squiffy.json": project, "story.squiffy": "", "b.squiffy": "", "sub/a.squiffy": "",
            "drafts/x.squiffy": "", "node_modules/m/y.squiffy": "", ".git/z.squiffy": "",
        });
        expect(await findStory(dir)).toEqual({
            mainFile: path.join(dir, "story.squiffy"),
            storyFiles: [path.join(dir, "b.squiffy"), path.join(dir, "sub/a.squiffy")],
            projectFile: path.join(dir, "squiffy.json"),
            expressions: true,
        });
    });

    test("a project's backButton setting comes with it", async () => {
        await write({ "squiffy.json": "{ \"version\": 1, \"main\": \"story.squiffy\", \"backButton\": false }", "story.squiffy": "" });
        expect((await findStory(dir)).backButton).toBe(false);
    });

    test("a project's id and saveButton setting come with it", async () => {
        await write({ "squiffy.json": "{ \"version\": 1, \"id\": \"abc\", \"main\": \"story.squiffy\", \"saveButton\": false }", "story.squiffy": "" });
        const story = await findStory(dir);
        expect(story.projectId).toBe("abc");
        expect(story.saveButton).toBe(false);
    });

    test("a project's panels come with it", async () => {
        await write({ "squiffy.json": "{ \"version\": 1, \"main\": \"story.squiffy\", \"panels\": [{ \"passage\": \"bag\", \"label\": \"Bag\" }] }", "story.squiffy": "" });
        expect((await findStory(dir)).panels).toEqual([{ passage: "bag", label: "Bag" }]);
    });

    test("a project's strings come with it", async () => {
        await write({ "squiffy.json": "{ \"version\": 1, \"main\": \"story.squiffy\", \"strings\": { \"back\": \"Retour\" } }", "story.squiffy": "" });
        expect((await findStory(dir)).strings).toEqual({ back: "Retour" });
    });

    test("the main file builds the project, even from a subfolder's squiffy.json", async () => {
        await write({ "squiffy.json": "{ \"version\": 1, \"main\": \"src/story.squiffy\" }", "src/story.squiffy": "", "src/b.squiffy": "" });
        const story = await findStory(path.join(dir, "src/story.squiffy"));
        expect(story.storyFiles).toEqual([path.join(dir, "src/b.squiffy")]);
    });

    test("another file builds just that file, with a note", async () => {
        await write({ "squiffy.json": project, "story.squiffy": "", "other.squiffy": "" });
        const story = await findStory(path.join(dir, "other.squiffy"));
        expect(story.mainFile).toBe(path.join(dir, "other.squiffy"));
        expect(story.storyFiles).toBeUndefined();
        expect(story.note).toContain("Building just other.squiffy, as it isn't the main file");
        // It's still in a project, so it uses the project's rules for @set (#373)
        expect(story.expressions).toBe(true);
    });

    test("a file with no squiffy.json builds just that file", async () => {
        await write({ "story.squiffy": "", "other.squiffy": "" });
        expect(await findStory(path.join(dir, "story.squiffy"))).toEqual({ mainFile: path.join(dir, "story.squiffy"), expressions: false });
    });

    test.each([
        ["a folder with no squiffy.json", {}, "", "There's no squiffy.json in"],
        ["a newer squiffy.json", { "squiffy.json": "{ \"version\": 2, \"main\": \"story.squiffy\" }", "story.squiffy": "" }, "", "needs a newer version of Squiffy"],
        ["a missing main file", { "squiffy.json": project }, "", "doesn't exist"],
        ["a missing input file", {}, "nope.squiffy", "doesn't exist"],
    ])("refuses %s", async (_, files: Record<string, string>, input, message) => {
        await write(files);
        const error = await findStory(path.join(dir, input)).catch(e => e);
        expect(error).toBeInstanceOf(StoryNotFoundError);
        expect(error.message).toContain(message);
    });

    test("skips extra folders", async () => {
        await write({ "squiffy.json": project, "story.squiffy": "", "out/a.squiffy": "" });
        expect((await findStory(dir, { skip: ["out"] })).storyFiles).toEqual([]);
    });

    test("stylesheets and scripts come after the .squiffy files, leaving out the build folder and an old build", async () => {
        await write({
            "squiffy.json": project, "story.squiffy": "", "b.squiffy": "", "z.css": "", "a.js": "",
            "build/index.html": "", "build/story.js": "", "index.html": "", "story.js": "", "style.css": "",
        });
        expect((await findStory(dir)).storyFiles).toEqual([path.join(dir, "b.squiffy"), path.join(dir, "z.css"), path.join(dir, "a.js")]);
    });

    test("skips absolute paths inside the project, and ignores those outside it", async () => {
        await write({ "squiffy.json": project, "story.squiffy": "", "dist/a.js": "", "vite.config.js": "", "b.js": "" });
        const skip = [path.join(dir, "dist"), path.join(dir, "vite.config.js"), path.dirname(dir)];
        expect((await findStory(dir, { skip })).storyFiles).toEqual([path.join(dir, "b.js")]);
    });
});

test("listSquiffyFiles doesn't look in node_modules or dot-folders", async () => {
    await write({ "a.squiffy": "", "b/c.squiffy": "", "b/d.txt": "", "node_modules/e.squiffy": "", ".x/f.squiffy": "" });
    expect((await listSquiffyFiles(dir)).sort()).toEqual(["a.squiffy", "b/c.squiffy"]);
});
