import { describe, expect, test } from "vitest";
import { folderNameFor, newStoryText } from "./new-story.js";

describe("folderNameFor", () => {
    test("keeps an ordinary title", () => {
        expect(folderNameFor("The Haunted House")).toBe("The Haunted House");
        expect(folderNameFor("Café Noir")).toBe("Café Noir");
    });

    test("drops characters a folder name can't have", () => {
        expect(folderNameFor("Who? What: Why/How")).toBe("Who What Why How");
        expect(folderNameFor("  lots   of\tspace  ")).toBe("lots of space");
    });

    test("drops leading and trailing dots", () => {
        expect(folderNameFor("...and then")).toBe("and then");
        expect(folderNameFor("The End.")).toBe("The End");
    });

    test("is empty when nothing's left", () => {
        expect(folderNameFor("???")).toBe("");
        expect(folderNameFor(" . ")).toBe("");
    });

    test("avoids names Windows reserves", () => {
        expect(folderNameFor("con")).toBe("con story");
        expect(folderNameFor("Aux")).toBe("Aux story");
    });

    test("is at most 100 characters", () => {
        expect(folderNameFor("a".repeat(150))).toHaveLength(100);
    });
});

test("newStoryText sets the title", () => {
    expect(newStoryText("@title New Story\n\nHello", "  My   Story ")).toBe("@title My Story\n\nHello");
});
