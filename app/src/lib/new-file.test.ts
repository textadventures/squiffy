import { describe, expect, test } from "vitest";
import { needsImport, newFileText } from "./new-file.js";

describe("new file text", () => {
    test("a .squiffy file starts with a section named after it", () => {
        expect(newFileText("chapters/cave.squiffy")).toBe("[[cave]]:\n\n");
    });

    test("a .css file has the defaults commented out", () => {
        const text = newFileText("styles/my_style.css");
        expect(text).toContain("--squiffy-font-size: 1.125rem;");
        expect(text).toContain("/styling/");
        // Everything is commented out, so the file changes nothing until the author edits it
        expect(text.replace(/\/\*[^]*?\*\//g, "").trim()).toBe("");
    });

    test("other files start empty", () => {
        expect(newFileText("notes.txt")).toBe("");
    });
});

describe("needs import", () => {
    test("stylesheets and scripts need an @import, other files don't", () => {
        expect(needsImport("style.css")).toBe(true);
        expect(needsImport("scripts/Game.JS")).toBe(true);
        expect(needsImport("chapter.squiffy")).toBe(false);
        expect(needsImport("notes.txt")).toBe(false);
    });
});
