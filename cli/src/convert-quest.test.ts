import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { convertQuestFile } from "./convert-quest.js";
import { strToU8, zipSync } from "fflate";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_DIR = path.join(__dirname, "..", "test-fixtures-convert-quest");
const aslxFile = path.join(TEST_DIR, "cave.aslx");
const outputFolder = path.join(TEST_DIR, "cave");

const aslx = `<asl version="580">
  <game name="The Cave">
    <showtitle type="boolean">false</showtitle>
  </game>
  <object name="Start">
    <description>You're at the mouth of a cave.</description>
    <picture>cave.png</picture>
    <options type="stringdictionary"><item><key>Inside</key><value>Go in</value></item></options>
    <object name="player"><inherit name="defaultplayer" /></object>
  </object>
  <object name="Inside">
    <description>It's dark. {either torch:You can see.}</description>
  </object>
  <type name="defaultgame"><attr name="_editorstyle">gamebook</attr></type>
</asl>`;

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

describe("convertQuestFile", () => {
    test("converts a .aslx file into a folder named after it, with the files it uses", async () => {
        await fs.writeFile(aslxFile, aslx);
        await fs.writeFile(path.join(TEST_DIR, "cave.png"), "png");
        await fs.writeFile(path.join(TEST_DIR, "unrelated.txt"), "not copied");

        expect(convertQuestFile(aslxFile)).toBe(true);

        const story = await fs.readFile(path.join(outputFolder, "story.squiffy"), "utf8");
        expect(story).toContain("@title The Cave");
        expect(story).toContain("[[Start]]:\n<img class=\"quest-picture\" src=\"cave.png\" alt=\"\">\n\nYou're at the mouth of a cave.\n\n[[Go in]](Inside)");
        expect(JSON.parse(await fs.readFile(path.join(outputFolder, "squiffy.json"), "utf8")).main).toBe("story.squiffy");
        expect(await fs.readFile(path.join(outputFolder, "cave.png"), "utf8")).toBe("png");
        await expect(fs.access(path.join(outputFolder, "unrelated.txt"))).rejects.toThrow();
        expect(await fs.readFile(path.join(outputFolder, "quest-import.txt"), "utf8")).toContain("Quest expressions in text can't be converted yet.");
    });

    test("converts a .quest file, with the files in it", async () => {
        const questFile = path.join(TEST_DIR, "cave.quest");
        await fs.writeFile(questFile, zipSync({
            "game.aslx": strToU8(aslx),
            "cave.png": strToU8("png"),
            "sounds/drip.mp3": strToU8("mp3"),
            "quest.js": strToU8("// Quest's"),
            "../escape.txt": strToU8("not written"),
        }));

        expect(convertQuestFile(questFile)).toBe(true);

        expect(await fs.readFile(path.join(outputFolder, "cave.png"), "utf8")).toBe("png");
        expect(await fs.readFile(path.join(outputFolder, "sounds", "drip.mp3"), "utf8")).toBe("mp3");
        await expect(fs.access(path.join(TEST_DIR, "escape.txt"))).rejects.toThrow();
        // Quest's JavaScript is kept out of the story
        expect(JSON.parse(await fs.readFile(path.join(outputFolder, "squiffy.json"), "utf8")).exclude).toEqual(["quest.js"]);
    });

    test("doesn't write into a folder that has files in it", async () => {
        await fs.writeFile(aslxFile, aslx);
        await fs.mkdir(outputFolder);
        await fs.writeFile(path.join(outputFolder, "notes.txt"), "mine");

        expect(convertQuestFile(aslxFile)).toBe(false);

        await expect(fs.access(path.join(outputFolder, "story.squiffy"))).rejects.toThrow();
    });

    test("says if the game is a text adventure", async () => {
        await fs.writeFile(aslxFile, "<asl version=\"550\"><include ref=\"Core.aslx\" /><game name=\"Cave\"></game></asl>");

        expect(convertQuestFile(aslxFile)).toBe(false);

        expect(console.error).toHaveBeenCalledWith("This is a Quest text adventure, not a gamebook. Only gamebooks can be converted to Squiffy.");
    });
});
