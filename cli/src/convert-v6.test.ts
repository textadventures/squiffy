import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { convertV6Story } from "./convert-v6.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_DIR = path.join(__dirname, "..", "test-fixtures-convert-v6");
const file = (name: string) => path.join(TEST_DIR, name);
const read = (name: string) => fs.readFile(file(name), "utf8");
const exists = (name: string) => fs.access(file(name)).then(() => true, () => false);

beforeEach(async () => {
    await fs.mkdir(path.join(TEST_DIR, "parts"), { recursive: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe("convertV6Story", () => {
    test("converts the main file and its imports, keeps backups, and adds a squiffy.json", async () => {
        const main = "@import parts/shop.squiffy\n\n[[start]]:\n@set weapon = sword\n[[Shop]](shop, gold = @start_gold)";
        const shop = "[[shop]]:\n@set mood = grumpy";
        const unchanged = "[[other]]:\n@set gold = 10";
        await fs.writeFile(file("story.squiffy"), main);
        await fs.writeFile(file("parts/shop.squiffy"), shop);
        await fs.writeFile(file("parts/other.squiffy"), "@import ../unused.squiffy");
        await fs.writeFile(file("unused.squiffy"), unchanged);
        await fs.writeFile(file("story2.squiffy"), "[[x]]:\n@set a = b");

        expect(await convertV6Story(file("story.squiffy"))).toBe(true);

        expect(await read("story.squiffy")).toBe("@import parts/shop.squiffy\n\n[[start]]:\n@set weapon = \"sword\"\n[[Shop]](shop, gold = start_gold)");
        expect(await read("parts/shop.squiffy")).toBe("[[shop]]:\n@set mood = \"grumpy\"");
        expect(await read("story.squiffy.bak")).toBe(main);
        expect(await read("parts/shop.squiffy.bak")).toBe(shop);
        // Files that aren't part of the story are left alone, and left out of it
        expect(await read("story2.squiffy")).toBe("[[x]]:\n@set a = b");
        expect(JSON.parse(await read("squiffy.json"))).toMatchObject({
            main: "story.squiffy",
            exclude: ["parts/other.squiffy", "story2.squiffy", "unused.squiffy"],
        });
    });

    test("leaves out stylesheets and scripts that weren't part of the story", async () => {
        await fs.mkdir(file("lib"));
        await fs.mkdir(file("tools"));
        await fs.writeFile(file("story.squiffy"), "@import used.css\n@import lib/*.js\n[[start]]:\nHi");
        await fs.writeFile(file("used.css"), "");
        await fs.writeFile(file("unused.css"), "");
        await fs.writeFile(file("lib/a.js"), "");
        await fs.writeFile(file("tools/build.js"), "");
        // An old build, which is left out anyway
        await fs.writeFile(file("index.html"), "");
        await fs.writeFile(file("story.js"), "");
        await fs.writeFile(file("style.css"), "");

        expect(await convertV6Story(file("story.squiffy"))).toBe(true);
        expect(JSON.parse(await read("squiffy.json")).exclude).toEqual(["unused.css", "tools/build.js"]);
    });

    test("adds a squiffy.json even if nothing needs converting", async () => {
        await fs.writeFile(file("story.squiffy"), "[[start]]:\n@set gold = 10");
        expect(await convertV6Story(file("story.squiffy"))).toBe(true);
        expect(await exists("story.squiffy.bak")).toBe(false);
        expect(JSON.parse(await read("squiffy.json")).main).toBe("story.squiffy");
    });

    test("refuses a story that already has a squiffy.json", async () => {
        await fs.writeFile(file("story.squiffy"), "[[start]]:\n@set a = b");
        await fs.writeFile(file("squiffy.json"), "{ \"version\": 1, \"main\": \"story.squiffy\" }");
        expect(await convertV6Story(file("story.squiffy"))).toBe(false);
        expect(await read("story.squiffy")).toBe("[[start]]:\n@set a = b");
    });

    test("refuses a story with Squiffy 5 syntax", async () => {
        await fs.writeFile(file("story.squiffy"), "[[start]]:\n{if x:yes}\n@set a = b");
        expect(await convertV6Story(file("story.squiffy"))).toBe(false);
        expect(await exists("squiffy.json")).toBe(false);
    });

    test("changes nothing if a backup is in the way", async () => {
        await fs.writeFile(file("story.squiffy"), "[[start]]:\n@set a = b");
        await fs.writeFile(file("story.squiffy.bak"), "old");
        expect(await convertV6Story(file("story.squiffy"))).toBe(false);
        expect(await read("story.squiffy")).toBe("[[start]]:\n@set a = b");
        expect(await exists("squiffy.json")).toBe(false);
    });
});
