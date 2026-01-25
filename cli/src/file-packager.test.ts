import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { writeScriptFile, createPackageFiles } from "./file-packager.js";
import { externalFiles } from "./external-files.js";
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
});
