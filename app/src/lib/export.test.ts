import { describe, expect, test } from "vitest";
import { strToU8, strFromU8, zipSync } from "fflate";
import { fileName, guessMainFile, readProjectZip, zipMainFile, zipTwineFile } from "./export.js";
import { relativePath, storyPath } from "./paths.js";

describe("project zips", () => {
    test("reads the files, unwrapping a single top-level folder and skipping junk", () => {
        const zip = zipSync({
            "cave/story.squiffy": strToU8("@title Cave"),
            "cave/chapters/one.squiffy": strToU8("[[one]]:"),
            "cave/images/bat.png": new Uint8Array([1, 2, 3]),
            "cave/.DS_Store": new Uint8Array([0]),
            "__MACOSX/cave/._story.squiffy": new Uint8Array([0]),
        });
        // A Mac's __MACOSX folder doesn't count as a second top-level folder
        const files = readProjectZip(zip);
        expect([...files.keys()].sort()).toEqual(["chapters/one.squiffy", "images/bat.png", "story.squiffy"]);

        const plain = readProjectZip(zipSync({ "cave/story.squiffy": strToU8("@title Cave"), "cave/bat.png": new Uint8Array([1]) }));
        expect([...plain.keys()].sort()).toEqual(["bat.png", "story.squiffy"]);
        expect(strFromU8(plain.get("story.squiffy")!)).toBe("@title Cave");
    });

    test("keeps a zip with files at the top as it is", () => {
        const files = readProjectZip(zipSync({ "story.squiffy": strToU8(""), "chapters/one.squiffy": strToU8("") }));
        expect([...files.keys()].sort()).toEqual(["chapters/one.squiffy", "story.squiffy"]);
    });

    test("guesses the main file: the top-most .squiffy file, then by name", () => {
        expect(guessMainFile(["chapters/a.squiffy", "story.squiffy", "bat.png"])).toBe("story.squiffy");
        expect(guessMainFile(["b.squiffy", "a.squiffy"])).toBe("a.squiffy");
        expect(guessMainFile(["bat.png"])).toBeUndefined();
    });
});

describe("a zip's main file", () => {
    const files = (entries: Record<string, string>) => new Map(Object.entries(entries).map(([path, text]) => [path, strToU8(text)]));

    test("comes from squiffy.json, instead of a guess", () => {
        expect(zipMainFile(files({
            "a.squiffy": "", "story/main.squiffy": "",
            "squiffy.json": "{ \"version\": 1, \"main\": \"story/main.squiffy\" }",
        }))).toBe("story/main.squiffy");
    });

    test("is guessed when squiffy.json is missing, broken or names a file that isn't there", () => {
        expect(zipMainFile(files({ "b.squiffy": "", "a.squiffy": "" }))).toBe("a.squiffy");
        expect(zipMainFile(files({ "b.squiffy": "", "a.squiffy": "", "squiffy.json": "{" }))).toBe("a.squiffy");
        expect(zipMainFile(files({ "a.squiffy": "", "squiffy.json": "{ \"version\": 1, \"main\": \"gone.squiffy\" }" }))).toBe("a.squiffy");
    });
});

describe("names and paths", () => {
    test("makes a file name from a title", () => {
        expect(fileName("The Cave: Part 1?", ".zip")).toBe("The Cave Part 1.zip");
        expect(fileName("  ", ".html")).toBe("story.html");
    });

    test("gives paths from the main file's folder", () => {
        expect(storyPath({ mainFile: "story.squiffy" }, "images/bat.png")).toBe("images/bat.png");
        expect(storyPath({ mainFile: "game/story.squiffy" }, "game/bat.png")).toBe("bat.png");
        expect(relativePath("game", "shared/style.css")).toBe("../shared/style.css");
    });
});

describe("a zip's Twine story", () => {
    const files = (paths: string[]) => new Map(paths.map(p => [p, new Uint8Array()]));

    test("is its only .twee file, else its only HTML file", () => {
        expect(zipTwineFile(files(["story.twee", "index.html"]))).toBe("story.twee");
        expect(zipTwineFile(files(["game/index.html", "game/cave.png"]))).toBe("game/index.html");
        expect(zipTwineFile(files(["a.html", "b.html"]))).toBeUndefined();
        expect(zipTwineFile(files(["a.twee", "b.twee", "c.html"]))).toBeUndefined();
    });
});
