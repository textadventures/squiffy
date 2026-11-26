import { describe, expect, test, vi } from "vitest";
import { decodeStory, payloadFromFragment } from "@textadventures/squiffy-player/link";
import { createStoryLink, MAX_ASSET_BYTES, playerFolder } from "@textadventures/squiffy-app/story-link";

vi.mock("vscode", () => ({}));
const { fileList, linkMessage, linkPaths, PLAYER_ORIGIN } = await import("./share.js");

describe("linkPaths", () => {
    test("leaves out an earlier export, playthrough tests and backups", () => {
        const paths = ["story.squiffy", "squiffy.json", "build/story.js", "build/index.html", "cat.png", "tests/ending.squiffy-test", "story.squiffy.bak", "builder.js"];
        expect(linkPaths(paths, "story.squiffy")).toEqual(["story.squiffy", "squiffy.json", "cat.png", "builder.js"]);
    });

    test("the build folder is the main file's", () => {
        expect(linkPaths(["game/main.squiffy", "game/build/story.js", "build/notes.css"], "game/main.squiffy")).toEqual(["game/main.squiffy", "build/notes.css"]);
    });
});

describe("the link", () => {
    test("is for this major version's player on squiffystories.com, with the story in it", () => {
        const files = new Map<string, string | Uint8Array>([["story.squiffy", "Hello"], ["cat.png", new Uint8Array([1, 2, 3])], ["song.mp3", new Uint8Array(MAX_ASSET_BYTES + 1)]]);
        const link = createStoryLink(files, "story.squiffy", playerFolder(PLAYER_ORIGIN, "7.0.0-beta.19"));
        if ("error" in link) throw new Error(link.error);
        expect(link.url).toMatch(/^https:\/\/squiffystories\.com\/v7\/#story=1[\w-]+$/);
        const story = decodeStory(payloadFromFragment(new URL(link.url).hash)!)!;
        expect(story.files).toEqual({ "story.squiffy": "Hello" });
        expect(link.leftOut).toEqual(["song.mp3"]);
    });
});

describe("linkMessage", () => {
    const link = { url: "", noEditUrl: "", assets: [], leftOut: [] };

    test("says what the link is", () => {
        expect(linkMessage(link, "https://squiffystories.com/v7/#story=1abc")).toMatch(/^Copied a link to the story\. Anyone who opens it can play it on squiffystories\.com/);
        expect(linkMessage(link, "x")).not.toContain("chat apps");
    });

    test("warns about a long link, and says what's not in it", () => {
        const message = linkMessage({ ...link, leftOut: ["a.mp3", "b.mp3", "c.jpg", "d.jpg"] }, "x".repeat(2500));
        expect(message).toContain("At 2,500 characters, it's too long for some chat apps");
        expect(message).toContain("Not in the link: a.mp3, b.mp3, c.jpg and 1 more.");
        expect(message).toContain(`images of up to ${MAX_ASSET_BYTES / 1024} KB each`);
    });
});

test("fileList names the first few files", () => {
    expect(fileList(["a"])).toBe("a");
    expect(fileList(["a", "b", "c"])).toBe("a, b, c");
    expect(fileList(["a", "b", "c", "d", "e"])).toBe("a, b, c and 2 more");
});
