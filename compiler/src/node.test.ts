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
});

test("listSquiffyFiles doesn't look in node_modules or dot-folders", async () => {
    await write({ "a.squiffy": "", "b/c.squiffy": "", "b/d.txt": "", "node_modules/e.squiffy": "", ".x/f.squiffy": "" });
    expect((await listSquiffyFiles(dir)).sort()).toEqual(["a.squiffy", "b/c.squiffy"]);
});
