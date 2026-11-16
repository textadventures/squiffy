import { expect, test } from "vitest";
import { compile } from "squiffy-compiler";
import { MemoryFileSystem } from "@textadventures/project-fs";
import { globToRegExp, projectExternalFiles, relativePath } from "./project-external-files.js";

test("globToRegExp", () => {
    expect(globToRegExp("*.squiffy").test("a.squiffy")).toBe(true);
    expect(globToRegExp("*.squiffy").test("dir/a.squiffy")).toBe(false);
    expect(globToRegExp("**/*.squiffy").test("a.squiffy")).toBe(true);
    expect(globToRegExp("**/*.squiffy").test("x/y/a.squiffy")).toBe(true);
    expect(globToRegExp("ch?.squiffy").test("ch1.squiffy")).toBe(true);
    expect(globToRegExp("a+b(1).js").test("a+b(1).js")).toBe(true);
});

test("relativePath", () => {
    expect(relativePath("", "a/b.js")).toBe("a/b.js");
    expect(relativePath("story", "story/b.js")).toBe("b.js");
    expect(relativePath("story", "lib/b.js")).toBe("../lib/b.js");
});

test("compiles a multi-file project from the file system", async () => {
    const fs = await MemoryFileSystem.from({
        "story/main.squiffy": "@title Test\n@import chapters/*.squiffy\n@import ../shared/style.css\n@import script.js\n@import ../../outside.js\n\nStart. [[Next]](chapter1)",
        "story/chapters/one.squiffy": "[[chapter1]]:\nChapter one.",
        "story/chapters/notes.txt": "not imported",
        "story/script.js": "// js",
        "shared/style.css": "body {}",
    });
    const files = projectExternalFiles(fs, "story/main.squiffy");
    const result = await compile({
        scriptBaseFilename: "main.squiffy",
        script: await fs.readText("story/main.squiffy"),
        externalFiles: files,
    });
    if (!result.success) throw new Error(result.errors.join("\n"));
    expect(Object.keys(result.output.story.sections)).toContain("chapter1");
    const ui = result.getUiInfo();
    expect(ui.title).toBe("Test");
    expect(ui.externalScripts).toEqual(["script.js"]);
    expect(ui.externalStylesheets).toEqual(["../shared/style.css"]);
});

test("doesn't import a file twice, or the main file", async () => {
    const fs = await MemoryFileSystem.from({
        "main.squiffy": "",
        "a.squiffy": "",
        "b.squiffy": "",
    });
    const files = projectExternalFiles(fs, "main.squiffy");
    expect(await files.getMatchingFilenames("*.squiffy")).toEqual(["a.squiffy", "b.squiffy"]);
    await files.getContent("a.squiffy");
    expect(await files.getMatchingFilenames("*.squiffy")).toEqual(["b.squiffy"]);
    await expect(files.getContent("../x.js")).rejects.toThrow(/outside the project/);
});
