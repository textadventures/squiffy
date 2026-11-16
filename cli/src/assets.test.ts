import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { unzipSync } from "fflate";
import { findAssets } from "./assets.js";
import { createPackageFiles } from "./file-packager.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_DIR = path.join(__dirname, "..", "test-fixtures-assets");
const STORY_DIR = path.join(TEST_DIR, "story");
const storyFile = path.join(STORY_DIR, "story.squiffy");

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const writeFile = async (relativePath: string, content: string | Uint8Array = pngBytes) => {
    const filename = path.join(STORY_DIR, relativePath);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, content);
};

beforeEach(async () => {
    await fs.mkdir(STORY_DIR, { recursive: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe("findAssets", () => {
    test("finds referenced asset files in the story folder", async () => {
        await writeFile("cat.png");
        await writeFile("images/dog.jpg");
        await writeFile("sounds/meow.mp3");
        await writeFile("my cat.png");
        await writeFile("unused.png");

        const assets = findAssets(storyFile, `![A cat](cat.png)
<img src="./images/dog.jpg">
    squiffy.set("sound", "sounds/meow.mp3");
<img src="my%20cat.png">`);

        expect(Object.keys(assets).sort()).toEqual(["cat.png", "images/dog.jpg", "my cat.png", "sounds/meow.mp3"]);
        expect(new Uint8Array(assets["cat.png"])).toEqual(pngBytes);
    });

    test("ignores missing files, absolute URLs, non-asset files and files outside the story folder", async () => {
        await writeFile("cat.png");
        await writeFile("notes.txt", "notes");
        await fs.writeFile(path.join(TEST_DIR, "outside.png"), pngBytes);

        const assets = findAssets(storyFile, `missing.png
https://example.com/cat.png
//example.com/cat.png
notes.txt
../outside.png
story.squiffy`);

        expect(assets).toEqual({});
    });
});

describe("createPackageFiles with assets", () => {
    const story = `@title Assets

![A cat](cat.png)`;

    test("adds referenced assets to the zip", async () => {
        await writeFile("story.squiffy", story);
        await writeFile("cat.png");
        await writeFile("unused.png");

        expect(await createPackageFiles(storyFile, STORY_DIR, { createZip: true })).toBe(true);

        const zip = unzipSync(new Uint8Array(await fs.readFile(path.join(STORY_DIR, "output.zip"))));
        expect(Object.keys(zip).sort()).toEqual(["cat.png", "index.html", "squiffy.runtime.global.js", "story.js", "style.css"]);
        expect(zip["cat.png"]).toEqual(pngBytes);
    });

    test("embeds referenced assets in inline HTML", async () => {
        await writeFile("story.squiffy", story);
        await writeFile("cat.png");

        expect(await createPackageFiles(storyFile, STORY_DIR, { inlineHtml: true })).toBe(true);

        const html = await fs.readFile(path.join(STORY_DIR, "index.html"), "utf8");
        expect(html).toContain('"cat.png":"data:image/png;base64,iVBORw=="');
    });
});
