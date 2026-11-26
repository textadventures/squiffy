import { describe, expect, test } from "vitest";
import { looksLikeTwee } from "./twine-import.js";

describe("pasted Twee (#711)", () => {
    test("is a passage header and another, or a Twine link", () => {
        expect(looksLikeTwee(":: Start\nYou're at the mill.\n\n:: Mill floor\nDusty.")).toBe(true);
        expect(looksLikeTwee(":: Start\n[[Go inside->Mill floor]]")).toBe(true);
        expect(looksLikeTwee(":: Start [tag] {\"position\":\"100,100\"}\nHello.\n\n:: End\nBye.")).toBe(true);
    });

    test("isn't Squiffy, or a line that happens to start with ::", () => {
        expect(looksLikeTwee("[[Start]]:\nYou're at the mill. [[Go inside]](Mill floor)")).toBe(false);
        expect(looksLikeTwee(":: just a line")).toBe(false);
        expect(looksLikeTwee("a::b\nc::d")).toBe(false);
    });
});
