import { describe, expect, test } from "vitest";

import { findCssUrls, isRelativeUrl, resolveCssUrl, rewriteCssUrls } from "./css-urls.js";

describe("CSS url()s", () => {
    test("finds relative url()s, quoted or not", () => {
        const css = `
            @font-face { src: url("a.woff2") format("woff2"), url('b.woff') format("woff"); }
            body { background: url( images/bg.png ); }`;
        expect(findCssUrls(css)).toEqual(["a.woff2", "b.woff", "images/bg.png"]);
    });

    test("leaves web addresses, data: URIs, absolute paths and fragments alone", () => {
        const css = `a { background: url(https://example.com/a.png), url("data:image/png;base64,AAAA"),
            url(/abs.png), url(#grad), url(//cdn.example.com/b.png); }`;
        expect(findCssUrls(css)).toEqual([]);
        expect(["a.png", "./a.png", "../a.png"].every(isRelativeUrl)).toBe(true);
        expect(isRelativeUrl("")).toBe(false);
    });

    test("rewrites each relative url(), quoting what it's replaced with", () => {
        const css = "src: url(a.woff2), url(\"https://x/b.woff2\"), url('c d.png');";
        expect(rewriteCssUrls(css, url => `blob:${url}"`)).toBe(
            "src: url(\"blob:a.woff2\\\"\"), url(\"https://x/b.woff2\"), url(\"blob:c d.png\\\"\");");
        // Undefined leaves it as it was
        expect(rewriteCssUrls(css, () => undefined)).toBe(css);
    });

    test("resolves a url() from its stylesheet's folder", () => {
        expect(resolveCssUrl("fonts/literata/literata.css", "latin-400-normal.woff2")).toBe("fonts/literata/latin-400-normal.woff2");
        expect(resolveCssUrl("style.css", "./images/bg.png")).toBe("images/bg.png");
        expect(resolveCssUrl("css/style.css", "../images/my%20bg.png?v=2#x")).toBe("images/my bg.png");
        expect(resolveCssUrl("style.css", "../outside.png")).toBeNull();
    });
});
