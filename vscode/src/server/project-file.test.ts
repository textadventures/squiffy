import { expect, test } from "vitest";
import { projectFileExcludes } from "./project-file.js";

test("a new squiffy.json leaves out the folder's .squiffy, .css and .js files that aren't part of the story", () => {
    const paths = ["main.squiffy", "chapter.squiffy", "draft.squiffy", "style.css", "old.css", "helper.js", "tool.js", "cat.png", "build/story.js", "build/squiffy.css"];
    expect(projectFileExcludes("main.squiffy", paths, ["main.squiffy", "chapter.squiffy", "style.css", "helper.js"]))
        .toEqual(["draft.squiffy", "old.css", "tool.js"]);
});

test("leaves out nothing when everything's in the story", () => {
    expect(projectFileExcludes("main.squiffy", ["main.squiffy", "cat.png"], [])).toEqual([]);
});
