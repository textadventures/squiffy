import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { convertTwineFile } from "./convert-twine.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_DIR = path.join(__dirname, "..", "test-fixtures-convert-twine");
const tweeFile = path.join(TEST_DIR, "cave.twee");
const outputFolder = path.join(TEST_DIR, "cave");

const twee = `:: StoryTitle
The Cave

:: StoryData
{ "format": "Harlowe", "format-version": "3.3.9", "start": "Start" }

:: Start
(set: $torch to false)You're at the mouth of a cave. [[Go in->Cave]]

:: Cave
(if: $torch)[You can see.](else:)[It's dark.] (click: ?page)[Bats!]
`;

beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe("convertTwineFile", () => {
    test("converts the story into a folder named after the file", async () => {
        await fs.writeFile(tweeFile, twee);

        expect(convertTwineFile(tweeFile)).toBe(true);

        const story = await fs.readFile(path.join(outputFolder, "story.squiffy"), "utf8");
        expect(story).toContain("@title The Cave");
        expect(story).toContain("[[Start]]:\n@set torch = false\nYou're at the mouth of a cave. [[Go in]](Cave)");
        expect(story).toContain("{{#if torch}}You can see.{{else}}It's dark.{{/if}}");
        expect(JSON.parse(await fs.readFile(path.join(outputFolder, "squiffy.json"), "utf8")).main).toBe("story.squiffy");
        expect(await fs.readFile(path.join(outputFolder, "twine-import.txt"), "utf8")).toContain("Clicking anywhere on the page has been converted to Continue links.");
    });

    test("writes to the folder given", async () => {
        await fs.writeFile(tweeFile, twee);
        const other = path.join(TEST_DIR, "other");

        expect(convertTwineFile(tweeFile, other)).toBe(true);

        await expect(fs.access(path.join(other, "story.squiffy"))).resolves.toBeUndefined();
    });

    test("doesn't write into a folder that has files in it", async () => {
        await fs.writeFile(tweeFile, twee);
        await fs.mkdir(outputFolder);
        await fs.writeFile(path.join(outputFolder, "notes.txt"), "mine");

        expect(convertTwineFile(tweeFile)).toBe(false);

        await expect(fs.access(path.join(outputFolder, "story.squiffy"))).rejects.toThrow();
    });

    test("says if the file isn't a Twine story", async () => {
        const htmlFile = path.join(TEST_DIR, "page.html");
        await fs.writeFile(htmlFile, "<html><body>Hello</body></html>");

        expect(convertTwineFile(htmlFile)).toBe(false);

        expect(console.error).toHaveBeenCalledWith("This doesn't look like a Twine story: there's no story data in it.");
    });
});
