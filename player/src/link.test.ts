import { describe, expect, test } from "vitest";
import { deflateSync, strToU8, zipSync } from "fflate";
import { decodeStory, encodeStory, mainFile, payloadFromFragment, storyFragment, storyPath } from "./link.js";

const story = {
    files: {
        "story.squiffy": "@title The Cave\n\nYou're in a [[cave]].\n\n[[cave]]:\nIt's dark — très sombre. 🕯️\n",
        "squiffy.json": '{"version":1,"main":"story.squiffy"}',
    },
    main: "story.squiffy",
};

const base64 = (data: Uint8Array) => Buffer.from(data).toString("base64url");
// A payload from a list of files and what follows it
const pack = (list: unknown, rest = "") => "1" + base64(deflateSync(strToU8(JSON.stringify(list) + "\n" + rest)));

describe("encodeStory", () => {
    test("round-trips a story, with text that isn't ASCII", () => {
        expect(decodeStory(encodeStory(story))).toEqual(story);
    });

    test("round-trips images, byte for byte", () => {
        const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 7919) % 256);
        const withImages = { ...story, assets: { "cat.png": bytes, "images/empty.gif": new Uint8Array() } };
        expect(decodeStory(encodeStory(withImages))).toEqual(withImages);
    });

    test("puts the main file first, which is how a story with no squiffy.json says which it is", () => {
        const bare = { files: { "a.squiffy": "A", "style.css": "p {}", "b.squiffy": "B" }, main: "b.squiffy" };
        const decoded = decodeStory(encodeStory(bare))!;
        expect(decoded.main).toBe("b.squiffy");
        expect(decoded.files).toEqual(bare.files);
    });

    test("can ask the player not to show its edit button, without it showing in the link", () => {
        const payload = encodeStory({ ...story, edit: false });
        expect(decodeStory(payload)).toEqual({ ...story, edit: false });
        expect(payload).toMatch(/^1[A-Za-z0-9_-]+$/);
        expect(payload).not.toMatch(/edit/i);
        // Links without it show the button, as they always have
        expect(decodeStory(encodeStory(story))).not.toHaveProperty("edit");
        expect(decodeStory(pack([["story.squiffy", 2]], "Hi"))).not.toHaveProperty("edit");
    });

    test("ignores options it doesn't know, but not a link with only options", () => {
        expect(decodeStory(pack([["story.squiffy", 2], { edit: true, later: 1 }], "Hi"))).toEqual({ files: { "story.squiffy": "Hi" }, main: "story.squiffy" });
        expect(decodeStory(pack([{ edit: false }]))).toBeNull();
    });

    test("uses only characters that need no escaping in a link", () => {
        expect(encodeStory(story)).toMatch(/^1[A-Za-z0-9_-]+$/);
    });

    test("makes a story smaller", () => {
        const text = "You walk down the corridor, and the corridor walks down you. [[Carry on]]\n\n".repeat(40);
        expect(encodeStory({ files: { "story.squiffy": text } }).length).toBeLessThan(text.length / 5);
    });

    test("is shorter than a zip of the same files", () => {
        const zip = base64(zipSync(Object.fromEntries(Object.entries(story.files).map(([path, text]) => [path, strToU8(text)])), { level: 9 }));
        expect(encodeStory(story).length).toBeLessThan(zip.length * 0.75);
    });
});

describe("decodeStory", () => {
    test("is null for anything that isn't a story", () => {
        expect(decodeStory("")).toBeNull();
        expect(decodeStory("1")).toBeNull();
        expect(decodeStory("1!!!")).toBeNull();
        expect(decodeStory("1AAAA")).toBeNull();
        expect(decodeStory("2" + encodeStory(story).slice(1))).toBeNull();
        expect(decodeStory("1" + base64(deflateSync(strToU8("no list"))))).toBeNull();
        expect(decodeStory(pack("story"))).toBeNull();
        expect(decodeStory(pack([]))).toBeNull();
        expect(decodeStory(pack([["story.squiffy", "2"]], "Hi"))).toBeNull();
        expect(decodeStory(pack([["story.squiffy", 2], ["story.squiffy", 0]], "Hi"))).toBeNull();
    });

    test("needs the files to be as long as the list says", () => {
        expect(decodeStory(pack([["story.squiffy", 2]], "Hi"))).toEqual({ files: { "story.squiffy": "Hi" }, main: "story.squiffy" });
        expect(decodeStory(pack([["story.squiffy", 3]], "Hi"))).toBeNull();
        expect(decodeStory(pack([["story.squiffy", 1]], "Hi"))).toBeNull();
        expect(decodeStory(pack([["story.squiffy", -1]], "Hi"))).toBeNull();
    });

    test("needs a story file", () => {
        expect(decodeStory(pack([["cat.png", 2]], "Hi"))).toBeNull();
        expect(decodeStory(pack([["style.css", 2]], "Hi"))).toBeNull();
    });

    test("refuses paths outside the story's folder", () => {
        for (const path of ["../story.squiffy", "/story.squiffy", "a//b.squiffy", "a\\b.squiffy", "C:story.squiffy", ""]) {
            expect(decodeStory(pack([[path, 2]], "Hi"))).toBeNull();
        }
    });

    test("refuses a story that inflates to far too much", () => {
        const size = 8 * 1024 * 1024;
        const payload = pack([["story.squiffy", size]], "a".repeat(size));
        expect(payload.length).toBeLessThan(20000);
        expect(decodeStory(payload)).toBeNull();
    });
});

describe("the fragment", () => {
    test("round-trips a payload", () => {
        const payload = encodeStory(story);
        expect(payloadFromFragment(storyFragment(payload))).toBe(payload);
    });

    test("can have other things in it", () => {
        expect(payloadFromFragment("#start=cave&story=1abc")).toBe("1abc");
    });

    test("is null without a story", () => {
        expect(payloadFromFragment("")).toBeNull();
        expect(payloadFromFragment("#story=")).toBeNull();
        expect(payloadFromFragment("#other=1abc")).toBeNull();
    });
});

describe("mainFile", () => {
    test("is squiffy.json's", () => {
        expect(mainFile({ files: { "a.squiffy": "", "b.squiffy": "", "squiffy.json": '{"main":"b.squiffy"}' }, main: "a.squiffy" })).toBe("b.squiffy");
    });

    test("is the one named otherwise", () => {
        expect(mainFile({ files: { "a.squiffy": "", "b.squiffy": "" }, main: "b.squiffy" })).toBe("b.squiffy");
        expect(mainFile({ files: { "a.squiffy": "", "b.squiffy": "", "squiffy.json": "not json" }, main: "b.squiffy" })).toBe("b.squiffy");
    });

    test("is the first .squiffy file if none is named", () => {
        expect(mainFile({ files: { "style.css": "", "b.squiffy": "", "a.squiffy": "" } })).toBe("b.squiffy");
    });
});

describe("storyPath", () => {
    test("is the path from the main file's folder", () => {
        expect(storyPath("story.squiffy", "images/cat.png")).toBe("images/cat.png");
        expect(storyPath("src/story.squiffy", "src/images/cat.png")).toBe("images/cat.png");
    });

    test("is null for a file outside it", () => {
        expect(storyPath("src/story.squiffy", "cat.png")).toBeNull();
    });
});
