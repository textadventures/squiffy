import { describe, expect, test } from "vitest";
import { LANGUAGES, languageName, languageOptions, suggestedLanguage } from "./languages.js";

describe("languages", () => {
    test("a language is named in English, then in itself", () => {
        expect(languageName("fr")).toBe("French — français");
        expect(languageName("en")).toBe("English");
        expect(languageName("pt-BR")).toBe("Brazilian Portuguese — português (Brasil)");
    });

    test("a tag the browser can't name is shown as it is", () => {
        expect(languageName("qaa")).toBe("qaa");
    });

    test("the offered languages are in order of their names", () => {
        const names = languageOptions().map(o => o.name);
        expect(names).toHaveLength(LANGUAGES.length);
        expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
    });

    test.each([
        [["en-GB", "en"], "en"],
        [["fr-CA"], "fr"],
        [["pt-br"], "pt-BR"],
        [["pt"], "pt-PT"],
        [["no"], "nb"],
        [["cy", "de"], "de"],
        [["cy"], undefined],
        [["not a language"], undefined],
        [[], undefined],
    ])("the browser's %j suggests %s", (browser, suggested) => {
        expect(suggestedLanguage(browser)).toBe(suggested);
    });
});
