import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { writeScriptFile, createPackageFiles, createTestingFiles } from "./file-packager.js";
import { externalFiles } from "./external-files.js";
import { findStory } from "squiffy-compiler/node";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test fixtures directory
const TEST_DIR = path.join(__dirname, "..", "test-fixtures");
const OUTPUT_DIR = path.join(TEST_DIR, "output");

beforeEach(async () => {
    // Create test directories
    await fs.mkdir(TEST_DIR, { recursive: true });
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
});

afterEach(async () => {
    // Clean up all test files
    try {
        await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch {
        // Ignore cleanup errors
    }
});

describe("file-packager", () => {
    test("writeScriptFile creates JavaScript file", async () => {
        // Create a simple test story
        const testStory = path.join(TEST_DIR, "simple.squiffy");
        await fs.writeFile(testStory, `
@title Simple Test

[[start]]:
Hello world!

[[next]]:
This is a test.
`);

        const result = await writeScriptFile(testStory, OUTPUT_DIR, "story.js");

        expect(result).not.toBe(false);

        // Check that story.js was created
        const storyPath = path.join(OUTPUT_DIR, "story.js");
        const storyContent = await fs.readFile(storyPath, "utf8");

        expect(storyContent).toContain("var story");
        expect(storyContent).toContain("start");
        expect(storyContent).toContain("Hello world!");
    });

    test("writeScriptFile with custom filename", async () => {
        const testStory = path.join(TEST_DIR, "custom.squiffy");
        await fs.writeFile(testStory, `
@title Custom

[[section]]:
Content here.
`);

        await writeScriptFile(testStory, OUTPUT_DIR, "custom-story.js");

        // Check that custom-story.js was created
        const exists = await fs.access(path.join(OUTPUT_DIR, "custom-story.js"))
            .then(() => true)
            .catch(() => false);

        expect(exists).toBe(true);
    });

    test("writeScriptFile handles compilation errors", async () => {
        // Create a story with errors (passage without section)
        const testStory = path.join(TEST_DIR, "error.squiffy");
        await fs.writeFile(testStory, `
[my passage]:
This is invalid - passage without section.
`);

        const result = await writeScriptFile(testStory, OUTPUT_DIR, "story.js");

        expect(result).toBe(false);

        // story.js should not have been created
        const exists = await fs.access(path.join(OUTPUT_DIR, "story.js"))
            .then(() => true)
            .catch(() => false);

        expect(exists).toBe(false);
    });

    test("createPackageFiles creates full package", async () => {
        const testStory = path.join(TEST_DIR, "package.squiffy");
        await fs.writeFile(testStory, `
@title Package Test

[[main]]:
This is a complete story.

[Click here]:
You clicked!
`);

        const result = await createPackageFiles(testStory, OUTPUT_DIR, {});

        expect(result).toBe(true);

        // Check that all package files were created
        const files = await fs.readdir(OUTPUT_DIR);
        expect(files).toContain("index.html");
        expect(files).toContain("style.css");
        expect(files).toContain("story.js");
        expect(files).toContain("squiffy.runtime.global.js");

        // Verify content
        const html = await fs.readFile(path.join(OUTPUT_DIR, "index.html"), "utf8");
        expect(html).toContain("Package Test");
        expect(html).toContain("<script");

        const js = await fs.readFile(path.join(OUTPUT_DIR, "story.js"), "utf8");
        expect(js).toContain("var story");
    });

    test("createPackageFiles creates zip file", async () => {
        const testStory = path.join(TEST_DIR, "zip.squiffy");
        await fs.writeFile(testStory, `
@title Zip Test

[[section]]:
Content for zip test.
`);

        const result = await createPackageFiles(testStory, OUTPUT_DIR, { createZip: true });

        expect(result).toBe(true);

        // Check that zip file was created
        const files = await fs.readdir(OUTPUT_DIR);
        expect(files).toContain("output.zip");

        // Verify zip file has content
        const zipStats = await fs.stat(path.join(OUTPUT_DIR, "output.zip"));
        expect(zipStats.size).toBeGreaterThan(0);
    });

    test("@test sections are left out of the files written, and in the ones --serve shows", async () => {
        const write = async (project: object) => {
            await fs.writeFile(path.join(TEST_DIR, "squiffy.json"), JSON.stringify({ version: 1, main: "story.squiffy", ...project }));
            await fs.writeFile(path.join(TEST_DIR, "story.squiffy"), "[[hall]]:\n@end\nThe hall.\n\n[[shortcut]]:\n@test\n@set key\n{{goto \"hall\"}}\n");
            return findStory(TEST_DIR);
        };
        const read = (file: string) => fs.readFile(path.join(OUTPUT_DIR, file), "utf8");

        const story = await write({});
        expect(await createPackageFiles(story, OUTPUT_DIR)).toBe(true);
        expect(await read("story.js")).toContain("\"hall\"");
        expect(await read("story.js")).not.toContain("shortcut");
        expect(await read("index.html")).toContain("if (false && ");

        const testing = await createTestingFiles(story);
        expect(Object.keys(testing!).sort()).toEqual(["index.html", "story.js"]);
        expect(testing!["story.js"]).toContain("\"shortcut\"");
        expect(testing!["index.html"]).toContain("if (true && ");
        // The files on disk are still the published ones
        expect(await read("story.js")).not.toContain("shortcut");

        // A story that anyone can start anywhere is published with them
        const open = await write({ startAnywhere: true });
        expect(await createPackageFiles(open, OUTPUT_DIR, { startAnywhere: open.startAnywhere })).toBe(true);
        expect(await read("story.js")).toContain("\"shortcut\"");
        expect(await read("index.html")).toContain("if (true && ");
    });

    test("the page has squiffy.json's id, description, author, cover and language, and the cover is copied with the story", async () => {
        await fs.writeFile(path.join(TEST_DIR, "squiffy.json"), JSON.stringify({
            version: 1, id: "0b7c6d9e-3f1a-4e2b-9c5d-8a7f6e5d4c3b", main: "story.squiffy",
            description: "A cave.", author: "Ann", cover: "images/cover.png", language: "en-GB",
        }));
        await fs.writeFile(path.join(TEST_DIR, "story.squiffy"), "@title The Cave\n\nHello\n");
        await fs.mkdir(path.join(TEST_DIR, "images"));
        await fs.writeFile(path.join(TEST_DIR, "images", "cover.png"), "png");
        const story = await findStory(TEST_DIR);
        expect(await createPackageFiles(story, OUTPUT_DIR)).toBe(true);
        const html = await fs.readFile(path.join(OUTPUT_DIR, "index.html"), "utf8");
        expect(html).toContain("<meta property=\"ifiction:ifid\" content=\"0B7C6D9E-3F1A-4E2B-9C5D-8A7F6E5D4C3B\">");
        expect(html).toContain("<meta name=\"description\" content=\"A cave.\">");
        expect(html).toContain("<meta name=\"author\" content=\"Ann\">");
        expect(html).toContain("<html lang=\"en-GB\">");
        expect(html).toContain("<meta property=\"og:image\" content=\"images/cover.png\">");
        expect(await fs.readFile(path.join(OUTPUT_DIR, "images", "cover.png"), "utf8")).toBe("png");
        expect((await createTestingFiles(story))!["index.html"]).toContain("ifiction:ifid");

        // A cover that isn't there is left out
        await fs.rm(path.join(TEST_DIR, "images", "cover.png"));
        expect(await createPackageFiles(story, OUTPUT_DIR)).toBe(true);
        expect(await fs.readFile(path.join(OUTPUT_DIR, "index.html"), "utf8")).not.toContain("og:image");
    });

    test("a single-file page that --serve shows has the story with its @test sections in it", async () => {
        const file = path.join(TEST_DIR, "one.squiffy");
        await fs.writeFile(file, "[[hall]]:\nThe hall.\n\n[[shortcut]]:\n@test\nA shortcut.\n");
        const testing = await createTestingFiles(file, { inlineHtml: true });
        expect(Object.keys(testing!)).toEqual(["index.html"]);
        expect(testing!["index.html"]).toContain("A shortcut.");
    });

    test("createPackageFiles handles compilation errors", async () => {
        const testStory = path.join(TEST_DIR, "error2.squiffy");
        await fs.writeFile(testStory, `
[[section]]:
Some content.

@ui
This should fail - text in @ui block
`);

        const result = await createPackageFiles(testStory, OUTPUT_DIR, {});

        expect(result).toBe(false);

        // No files should have been created
        const files = await fs.readdir(OUTPUT_DIR);
        expect(files.length).toBe(0);
    });
});

describe("external-files", () => {
    test("getMatchingFilenames finds files by pattern", async () => {
        // Create some test files
        await fs.writeFile(path.join(TEST_DIR, "test1.txt"), "content 1");
        await fs.writeFile(path.join(TEST_DIR, "test2.txt"), "content 2");
        await fs.writeFile(path.join(TEST_DIR, "other.md"), "markdown");

        const testFile = path.join(TEST_DIR, "main.squiffy");
        const ext = externalFiles(testFile);

        const matches = await ext.getMatchingFilenames("*.txt");

        expect(matches.length).toBe(2);
        expect(matches.some(f => f.includes("test1.txt"))).toBe(true);
        expect(matches.some(f => f.includes("test2.txt"))).toBe(true);
        expect(matches.some(f => f.includes("other.md"))).toBe(false);
    });

    test("getMatchingFilenames returns matches sorted by relative path", async () => {
        await fs.mkdir(path.join(TEST_DIR, "b"), { recursive: true });
        for (const name of ["c.txt", "a.txt", "B.txt", "b/a.txt", "a-b.txt"]) {
            await fs.writeFile(path.join(TEST_DIR, name), name);
        }

        const ext = externalFiles(path.join(TEST_DIR, "main.squiffy"));
        const matches = await ext.getMatchingFilenames("**/*.txt");

        // The same plain string sort on "/"-separated relative paths as the editor
        expect(matches.map(f => ext.getLocalFilename(f).split(path.sep).join("/")))
            .toEqual(["B.txt", "a-b.txt", "a.txt", "b/a.txt", "c.txt"]);
    });

    test("getContent reads file content", async () => {
        const contentFile = path.join(TEST_DIR, "content.txt");
        await fs.writeFile(contentFile, "Hello from external file!");

        const testFile = path.join(TEST_DIR, "main.squiffy");
        const ext = externalFiles(testFile);

        const content = await ext.getContent(contentFile);

        expect(content).toBe("Hello from external file!");
    });

    test("getLocalFilename returns relative path", () => {
        const testFile = path.join(TEST_DIR, "main.squiffy");
        const ext = externalFiles(testFile);

        const absolutePath = path.join(TEST_DIR, "subdir", "file.js");
        const localPath = ext.getLocalFilename(absolutePath);

        expect(localPath).toBe(path.join("subdir", "file.js"));
    });

    test("getMatchingFilenames excludes already included files", async () => {
        const file1 = path.join(TEST_DIR, "included.txt");
        const file2 = path.join(TEST_DIR, "notincluded.txt");
        await fs.writeFile(file1, "already included");
        await fs.writeFile(file2, "not yet included");

        const testFile = path.join(TEST_DIR, "main.squiffy");
        const ext = externalFiles(testFile);

        // Simulate including file1
        await ext.getContent(file1);

        const matches = await ext.getMatchingFilenames("*.txt");

        // Should only find file2, not file1 (already included)
        expect(matches.length).toBe(1);
        expect(matches[0]).toContain("notincluded.txt");
    });

    test("a folder with a squiffy.json builds every .squiffy file in it", async () => {
        await fs.writeFile(path.join(TEST_DIR, "squiffy.json"), "{ \"version\": 1, \"main\": \"story.squiffy\", \"exclude\": [\"drafts/**\"] }");
        await fs.writeFile(path.join(TEST_DIR, "story.squiffy"), "@title Folder\n[[start]]:\nGo to [[chapter]].\n");
        await fs.mkdir(path.join(TEST_DIR, "chapters"), { recursive: true });
        await fs.writeFile(path.join(TEST_DIR, "chapters", "one.squiffy"), "[[chapter]]:\nFrom another file.\n");
        await fs.mkdir(path.join(TEST_DIR, "drafts"), { recursive: true });
        await fs.writeFile(path.join(TEST_DIR, "drafts", "draft.squiffy"), "[[draft]]:\nNot in the story.\n");

        const story = await findStory(TEST_DIR);
        expect(await writeScriptFile(story, OUTPUT_DIR, "story.js")).not.toBe(false);

        const storyContent = await fs.readFile(path.join(OUTPUT_DIR, "story.js"), "utf8");
        expect(storyContent).toContain("From another file.");
        expect(storyContent).not.toContain("Not in the story.");
    });

    test("a folder's stylesheets and scripts are part of it, and a build elsewhere gets copies of them and their assets", async () => {
        await fs.writeFile(path.join(TEST_DIR, "squiffy.json"), "{ \"version\": 1, \"main\": \"story.squiffy\" }");
        await fs.writeFile(path.join(TEST_DIR, "story.squiffy"), "[[start]]:\n<img src=\"cat.png\">\n");
        await fs.writeFile(path.join(TEST_DIR, "my.css"), "@font-face { src: url(fonts/f.woff2); }");
        await fs.writeFile(path.join(TEST_DIR, "my.js"), "window.x = 1;");
        await fs.writeFile(path.join(TEST_DIR, "cat.png"), "png");
        await fs.mkdir(path.join(TEST_DIR, "fonts"), { recursive: true });
        await fs.writeFile(path.join(TEST_DIR, "fonts", "f.woff2"), "font");
        // A stylesheet's url()s are from its own folder
        await fs.mkdir(path.join(TEST_DIR, "fonts", "story"), { recursive: true });
        await fs.writeFile(path.join(TEST_DIR, "fonts", "story", "story.css"), "@font-face { src: url(\"latin-400-normal.woff2\"); }");
        await fs.writeFile(path.join(TEST_DIR, "fonts", "story", "latin-400-normal.woff2"), "font");

        const build = path.join(TEST_DIR, "build");
        expect(await createPackageFiles(await findStory(TEST_DIR), build)).toBe(true);

        const html = await fs.readFile(path.join(build, "index.html"), "utf8");
        expect(html).toContain("<link rel=\"stylesheet\" href=\"my.css\"/>");
        expect(html).toContain("<script src=\"my.js\"></script>");
        for (const file of ["my.css", "my.js", "cat.png", "fonts/f.woff2", "fonts/story/story.css", "fonts/story/latin-400-normal.woff2", "story.js", "style.css"]) {
            await expect(fs.access(path.join(build, file))).resolves.toBeUndefined();
        }

        // Building again doesn't pick up the build, or an old one next to the main file
        await fs.writeFile(path.join(TEST_DIR, "index.html"), "");
        await fs.writeFile(path.join(TEST_DIR, "story.js"), "");
        expect((await findStory(TEST_DIR)).storyFiles).toEqual([path.join(TEST_DIR, "fonts", "story", "story.css"), path.join(TEST_DIR, "my.css"), path.join(TEST_DIR, "my.js")]);
    });
});
