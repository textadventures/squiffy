import { describe, expect, test } from "vitest";
import {
    categoryIn, chooseFaces, chooseWeights, fallbackFor, fontCss, fontFamilyIn, isStoryFont, setStoryFontIn, subsetLabel,
    type FontDetails,
} from "./fonts.js";

const file = (name: string) => ({ url: { woff2: `https://cdn.example/${name}.woff2`, woff: `https://cdn.example/${name}.woff` } });

const literata: FontDetails = {
    id: "literata",
    family: "Literata",
    category: "serif",
    subsets: ["cyrillic", "latin", "latin-ext"],
    weights: [300, 400, 700, 900],
    styles: ["italic", "normal"],
    license: "OFL-1.1",
    npmVersion: "5.3.0",
    unicodeRange: { "latin": "U+0000-00FF", "latin-ext": "U+0100-02BA", "cyrillic": "U+0400-045F" },
    variants: Object.fromEntries(["300", "400", "700", "900"].map(weight => [weight, Object.fromEntries(["normal", "italic"].map(style =>
        [style, Object.fromEntries(["cyrillic", "latin", "latin-ext"].map(subset => [subset, file(`${subset}-${weight}-${style}`)]))]))])),
};

describe("fonts", () => {
    test("chooses a regular and a bold weight", () => {
        expect(chooseWeights([300, 400, 700, 900])).toEqual([400, 700]);
        expect(chooseWeights([400])).toEqual([400]);
        expect(chooseWeights([300, 500, 800])).toEqual([300, 800]);
        expect(chooseWeights([100, 200, 300])).toEqual([300]);
        expect(chooseWeights([])).toEqual([]);
    });

    test("chooses the files for the regular and bold weights, normal and italic, in the chosen subsets", () => {
        const faces = chooseFaces(literata, ["latin", "latin-ext", "greek"]);
        expect(faces.map(f => f.file)).toEqual([
            "latin-400-normal.woff2", "latin-ext-400-normal.woff2", "latin-400-italic.woff2", "latin-ext-400-italic.woff2",
            "latin-700-normal.woff2", "latin-ext-700-normal.woff2", "latin-700-italic.woff2", "latin-ext-700-italic.woff2",
        ]);
        expect(faces[1]).toMatchObject({ weight: 400, style: "normal", unicodeRange: "U+0100-02BA", url: "https://cdn.example/latin-ext-400-normal.woff2" });
    });

    test("a subset that's numbered files, as a Japanese font's are, gets all of them", () => {
        const japanese: FontDetails = {
            ...literata, subsets: ["japanese", "latin"], weights: [400], styles: ["normal"],
            unicodeRange: { "[0]": "U+4E00-4EFF", "[1]": "U+4F00-4FFF", "latin": "U+0000-00FF" },
            variants: { "400": { normal: { "0": file("0"), "1": file("1"), "latin": file("latin") } } },
        };
        expect(chooseFaces(japanese, ["latin"]).map(f => f.file)).toEqual(["latin-400-normal.woff2"]);
        const faces = chooseFaces(japanese, ["japanese", "latin"]);
        expect(faces.map(f => f.file)).toEqual(["0-400-normal.woff2", "1-400-normal.woff2", "latin-400-normal.woff2"]);
        expect(faces[1].unicodeRange).toBe("U+4F00-4FFF");
    });

    test("writes a stylesheet with an @font-face rule for each file", () => {
        const css = fontCss(literata, chooseFaces(literata, ["latin"]), { storyFont: true, licence: true });
        expect(css).toMatch(/^\/\* Literata, a serif font from Fontsource: https:\/\/fontsource.org\/fonts\/literata\n/);
        expect(css).toContain("(OFL-1.1) is in LICENSE.txt");
        expect(css).toContain(":root {\n    --squiffy-font-family: \"Literata\", Georgia, serif;\n}");
        expect(css).toContain(`@font-face {
    font-family: "Literata";
    font-style: italic;
    font-weight: 700;
    font-display: swap;
    src: url("latin-700-italic.woff2") format("woff2");
    unicode-range: U+0000-00FF;
}`);
        expect(fontFamilyIn(css)).toBe("Literata");
        expect(categoryIn(css)).toBe("serif");
        expect(isStoryFont(css)).toBe(true);
        expect(isStoryFont(fontCss(literata, [], { storyFont: false, licence: false }))).toBe(false);
    });

    test("makes a font the story's font, and not, keeping the rest of its stylesheet", () => {
        const css = fontCss(literata, chooseFaces(literata, ["latin"]), { storyFont: true, licence: true });
        const without = setStoryFontIn(css, null);
        expect(isStoryFont(without)).toBe(false);
        expect(without).not.toContain("--squiffy-font-family");
        expect(without).toContain("@font-face");
        expect(without).not.toMatch(/\n\n\n/);
        // Back again, it's as it was
        expect(setStoryFontIn(without, { family: "Literata", fallback: "Georgia, serif" })).toBe(css);
        // Setting it twice doesn't add it twice
        expect(setStoryFontIn(css, { family: "Literata" }).match(/--squiffy-font-family/g)).toHaveLength(1);
    });

    test("finds the family in a stylesheet someone wrote themselves", () => {
        expect(fontFamilyIn("@font-face{font-family:'My \\'Font';src:url(a.woff2)}")).toBe("My 'Font");
        expect(fontFamilyIn("@font-face { src: url(a.woff2); font-family: Plain Name; }")).toBe("Plain Name");
        expect(fontFamilyIn("body { font-family: Georgia; }")).toBeUndefined();
        expect(categoryIn("@font-face {}")).toBeUndefined();
    });

    test("falls back on a font of the same kind", () => {
        expect(fallbackFor("serif")).toBe("Georgia, serif");
        expect(fallbackFor("sans-serif")).toBe("system-ui, sans-serif");
        expect(fallbackFor("monospace")).toBe("\"Courier New\", monospace");
        expect(fallbackFor("display")).toBe("Georgia, serif");
    });

    test("names subsets", () => {
        expect(subsetLabel("latin-ext")).toBe("Latin Extended");
        expect(subsetLabel("cyrillic")).toBe("Cyrillic");
    });
});
