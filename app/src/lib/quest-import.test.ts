import { describe, expect, test, vi } from "vitest";
import { strToU8, zipSync } from "fflate";

vi.mock("./confirm.js", () => ({ confirmDialog: async () => true }));

const { convertQuestFile, findQuestGame } = await import("./quest-import.js");

const GAME = `<asl version="610">
  <include ref="GamebookCore.aslx"/>
  <game name="Viva"></game>
  <object name="Page1"><description>Hello. {img:cave.png}</description><object name="player"><inherit name="defaultplayer" /></object></object>
</asl>`;

describe("the game in a zip", () => {
    test("is the top-most game.aslx, else the top-most .aslx file", () => {
        expect(findQuestGame(["book/old/game.aslx", "book/game.aslx", "book/cave.png"])).toBe("book/game.aslx");
        expect(findQuestGame(["book/a/b.aslx", "book/viva.aslx"])).toBe("book/viva.aslx");
        expect(findQuestGame(["book/story.squiffy"])).toBeUndefined();
    });
});

describe("converting a zip", () => {
    test("takes the game and the files beside it from a folder in the zip", async () => {
        const zip = zipSync({
            "Viva/game.aslx": strToU8(GAME),
            "Viva/cave.png": new Uint8Array([1, 2]),
            "__MACOSX/Viva/._cave.png": new Uint8Array([3]),
            "readme.txt": strToU8("not in the game's folder"),
        });
        const converted = await convertQuestFile("Viva.zip", zip);
        expect(converted).not.toBeNull();
        const paths = [...converted!.files.keys()];
        expect(paths).toContain("cave.png");
        expect(paths).toContain(converted!.mainFile);
        expect(paths.some(p => p.includes("MACOSX") || p.includes("readme") || p.endsWith(".aslx"))).toBe(false);
    });

    test("a zip that would unpack to too much isn't converted", async () => {
        const zip = zipSync({ "game.aslx": strToU8(GAME), "cave.png": new Uint8Array([1, 2]) });
        // Its directory says a file unpacks to nearly 4 GB, which it doesn't (#644)
        const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
        const entry = zip.findLastIndex((_, i) => i + 4 <= zip.length && view.getUint32(i, true) === 0x02014b50);
        view.setUint32(entry + 24, 0xfffffff0, true);
        await expect(convertQuestFile("Viva.quest", zip)).rejects.toThrow("Viva.quest is too big to convert");
    });
});
