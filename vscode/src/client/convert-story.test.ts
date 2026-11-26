import { describe, expect, test } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
    convertedMessage, convertQuestFile, convertTwineFile, findQuestGame, QUEST_PROBLEMS_FILE, safePath, storyFolderName,
    TWINE_PROBLEMS_FILE,
} from "./convert-story.js";

const TWEE = `:: StoryTitle
The Cave

:: StoryData
{"format": "Harlowe", "format-version": "3.3.9", "start": "Start"}

:: Start
You're in a cave. [[Go deeper->Deeper]]

:: Deeper
It's dark.
`;

// A Quest 5.5 gamebook, as the editor saves it, whose first page shows a picture
const ASLX = `<!--Saved by Quest 5.5-->
<asl version="550">
  <game name="The Cave">
    <gameid>1234</gameid>
  </game>
  <object name="Start">
    <object name="player"><inherit name="defaultplayer" /></object>
    <description><![CDATA[You're in a cave.]]></description>
    <options type="stringdictionary"><item><key>Deeper</key><value>Go deeper</value></item></options>
    <inherit name="picture" /><picture>cave.png</picture>
  </object>
  <object name="Deeper">
    <description><![CDATA[It's dark.]]></description>
  </object>
  <type name="defaultgame">
    <attr name="_editorstyle">gamebook</attr>
    <clearlastpage type="boolean">false</clearlastpage>
  </type>
  <function name="DoPage" parameters="page">msg (page.description)</function>
</asl>`;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const text = (content: Uint8Array | string | undefined) => typeof content == "string" ? content : "";

describe("storyFolderName", () => {
    test("is the file's name without its extension", () => {
        expect(storyFolderName("The Cave.twee")).toBe("The Cave");
        expect(storyFolderName("games/cave.quest")).toBe("cave");
        expect(storyFolderName("C:\\games\\cave.aslx")).toBe("cave");
        expect(storyFolderName("story")).toBe("story");
    });
});

describe("safePath", () => {
    test("keeps paths inside the folder", () => {
        expect(safePath("cave.png")).toBe("cave.png");
        expect(safePath("images\\cave.png")).toBe("images/cave.png");
    });
    test("refuses paths that would go outside it", () => {
        expect(safePath("../cave.png")).toBeUndefined();
        expect(safePath("/etc/passwd")).toBeUndefined();
        expect(safePath("C:/cave.png")).toBeUndefined();
        expect(safePath("images//cave.png")).toBeUndefined();
    });
});

describe("findQuestGame", () => {
    test("prefers the top-most game.aslx", () => {
        expect(findQuestGame(["sub/game.aslx", "other.aslx", "game.aslx", "cave.png"])).toBe("game.aslx");
        expect(findQuestGame(["b/x.aslx", "a.aslx"])).toBe("a.aslx");
        expect(findQuestGame(["cave.png"])).toBeUndefined();
    });
});

describe("convertTwineFile", () => {
    test("converts a Twee story, with the list of what couldn't be converted", () => {
        const converted = convertTwineFile("cave.twee", TWEE);
        expect(converted.main).toBe("story.squiffy");
        expect(text(converted.files.get("story.squiffy"))).toContain("[[Go deeper]](Deeper)");
        expect(converted.files.has("squiffy.json")).toBe(true);
        expect(text(converted.files.get(TWINE_PROBLEMS_FILE))).toContain("cave.twee");
        expect(converted.summary).toBe("Converted 2 passages from Harlowe 3.3.9.");
        expect(convertedMessage(converted)).toBe(converted.summary);
    });

    test("says when the file isn't a Twine story", () => {
        expect(() => convertTwineFile("notes.html", "<html><body>Hello</body></html>")).toThrow(/^notes.html isn't a Twine story/);
    });
});

describe("convertQuestFile", () => {
    test("converts a .quest file, with the images it uses", async () => {
        const quest = zipSync({ "game.aslx": strToU8(ASLX), "cave.png": PNG, "unused.png": PNG, "__MACOSX/._cave.png": PNG });
        const converted = await convertQuestFile("cave.quest", quest, () => { throw new Error("Not read from the folder"); });
        expect(converted.main).toBe("story.squiffy");
        expect(text(converted.files.get("story.squiffy"))).toContain("cave.png");
        expect(converted.files.get("cave.png")).toEqual(PNG);
        // Everything that came with the game, as the command-line tool copies it
        expect(converted.files.has("unused.png")).toBe(true);
        expect(converted.files.has("__MACOSX/._cave.png")).toBe(false);
        expect(converted.files.has(QUEST_PROBLEMS_FILE)).toBe(true);
        expect(converted.summary).toMatch(/^Converted 2 pages from a Quest .* gamebook\.$/);
    });

    test("finds the game in a folder in the zip", async () => {
        const quest = zipSync({ "cave/game.aslx": strToU8(ASLX), "cave/cave.png": PNG });
        const converted = await convertQuestFile("cave.quest", quest, async () => undefined);
        expect(converted.files.get("cave.png")).toEqual(PNG);
    });

    test("reads a .aslx file's images from its folder, and lists the missing ones", async () => {
        const read: string[] = [];
        const found = await convertQuestFile("game.aslx", strToU8(ASLX), async path => {
            read.push(path);
            return PNG;
        });
        expect(read).toEqual(["cave.png"]);
        expect(found.files.get("cave.png")).toEqual(PNG);
        expect(found.problems).toBe(0);

        const missing = await convertQuestFile("game.aslx", strToU8(ASLX), async () => undefined);
        expect(missing.files.has("cave.png")).toBe(false);
        expect(missing.problems).toBeGreaterThan(0);
        expect(text(missing.files.get(QUEST_PROBLEMS_FILE))).toContain("cave.png");
        expect(convertedMessage(missing)).toMatch(/1 thing couldn't be converted exactly: it's listed in quest-import.txt\.$/);
        expect(convertedMessage({ ...missing, problems: 2 })).toMatch(/2 things couldn't be converted exactly: they're listed in quest-import.txt\.$/);
    });

    test("says when the file isn't a gamebook", async () => {
        await expect(convertQuestFile("game.quest", strToU8("not a zip"), async () => undefined)).rejects.toThrow("game.quest isn't a Quest game: it isn't a zip file.");
        await expect(convertQuestFile("game.quest", zipSync({ "a.txt": strToU8("") }), async () => undefined)).rejects.toThrow("there's no game.aslx in it");
        const adventure = ASLX.replace("<attr name=\"_editorstyle\">gamebook</attr>", "");
        await expect(convertQuestFile("game.aslx", strToU8(adventure), async () => undefined)).rejects.toThrow(/^game.aslx can't be converted/);
    });
});
