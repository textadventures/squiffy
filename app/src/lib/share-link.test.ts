import { describe, expect, test } from "vitest";
import { decodeStory, mainFile, payloadFromFragment } from "@textadventures/squiffy-player/link";
import { createStoryLink, linkedStoryFiles, MAX_ASSET_BYTES, MAX_LINK_LENGTH } from "./share-link.js";

const project = JSON.stringify({ $schema: "https://squiffystory.com/schema/squiffy.json", version: 1, id: "abc-123", main: "story.squiffy", map: { cave: [1, 2] }, backButton: true }, null, 2);

const read = (url: string) => decodeStory(payloadFromFragment(new URL(url).hash)!)!;

describe("createStoryLink", () => {
    test("is a link to this version's player, with the story's text files and small images in it", () => {
        const files = new Map<string, string | Uint8Array>([
            ["story.squiffy", "Hello"], ["style.css", "p { color: red }"], ["squiffy.json", project],
            ["cat.png", new Uint8Array([1, 2, 3])], ["notes.txt", "Remember the cat"],
            ["photo.jpg", new Uint8Array(MAX_ASSET_BYTES + 1)], ["icon.png", new Uint8Array(MAX_ASSET_BYTES)],
        ]);
        const link = createStoryLink(files, "story.squiffy", "7.2.0-beta.1");
        if ("error" in link) throw new Error(link.error);
        expect(link.url).toMatch(/\/v7\/#story=1[\w-]+$/);
        expect(link.assets).toEqual(["cat.png", "icon.png"]);
        expect(link.leftOut).toEqual(["notes.txt", "photo.jpg"]);
        const story = read(link.url);
        expect(Object.keys(story.files).sort()).toEqual(["squiffy.json", "story.squiffy", "style.css"]);
        expect(story.files["story.squiffy"]).toBe("Hello");
        expect(story.assets?.["cat.png"]).toEqual(new Uint8Array([1, 2, 3]));
        expect(mainFile(story)).toBe("story.squiffy");
    });

    test("has a version that asks the player not to show its edit button, with the same story in it", () => {
        const link = createStoryLink(new Map([["story.squiffy", "Hello"]]), "story.squiffy", "7.0.0");
        if ("error" in link) throw new Error(link.error);
        expect(read(link.url).edit).toBeUndefined();
        expect(read(link.noEditUrl)).toEqual({ ...read(link.url), edit: false });
        expect(link.noEditUrl).toMatch(/\/v7\/#story=1[\w-]+$/);
    });

    test("leaves the story's ID and map out of squiffy.json", () => {
        const link = createStoryLink(new Map([["story.squiffy", "Hello"], ["squiffy.json", project]]), "story.squiffy", "7.0.0");
        if ("error" in link) throw new Error(link.error);
        expect(read(link.url).files["squiffy.json"]).toBe('{"version":1,"main":"story.squiffy","backButton":true}');
    });

    test("names the main file of a story with no squiffy.json", () => {
        const link = createStoryLink(new Map([["a.squiffy", "A"], ["b.squiffy", "B"]]), "b.squiffy", "7.0.0");
        if ("error" in link) throw new Error(link.error);
        expect(read(link.url).main).toBe("b.squiffy");
    });

    test("refuses a story that makes too long a link", () => {
        // Text that doesn't compress
        let seed = 1;
        const text = Array.from({ length: 60000 }, () => String.fromCharCode(33 + (seed = seed * 16807 % 2147483647) % 90)).join("");
        const link = createStoryLink(new Map([["story.squiffy", text]]), "story.squiffy", "7.0.0");
        expect(link).toEqual({ error: expect.stringContaining(MAX_LINK_LENGTH.toLocaleString()) });
        expect(link).toEqual({ error: expect.stringContaining("This story is too big") });
    });

    test("says so when it's the images that make the link too long", () => {
        let seed = 1;
        const noise = () => Uint8Array.from({ length: MAX_ASSET_BYTES }, () => (seed = seed * 16807 % 2147483647) % 256);
        const files = new Map<string, string | Uint8Array>([["story.squiffy", "Hello"]]);
        for (let i = 0; i < 8; i++) files.set(`image${i}.png`, noise());
        expect(createStoryLink(files, "story.squiffy", "7.0.0")).toEqual({ error: expect.stringContaining("images are too big") });
    });
});

describe("linkedStoryFiles", () => {
    test("gives the new story an ID of its own", () => {
        const link = createStoryLink(new Map<string, string | Uint8Array>([["story.squiffy", "Hello"], ["squiffy.json", project], ["cat.png", new Uint8Array([1, 2, 3])]]), "story.squiffy", "7.0.0");
        if ("error" in link) throw new Error(link.error);
        const files = linkedStoryFiles(read(link.url));
        expect(files.get("story.squiffy")).toBe("Hello");
        expect(files.get("cat.png")).toEqual(new Uint8Array([1, 2, 3]));
        const json = JSON.parse(files.get("squiffy.json") as string);
        expect(Object.keys(json)).toEqual(["$schema", "version", "id", "main", "backButton"]);
        expect(json.id).not.toBe("abc-123");
        expect(json.id).toMatch(/^[0-9a-f-]{36}$/);
    });
});
