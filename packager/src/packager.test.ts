import { expect, test } from "vitest";
import { compile } from "squiffy-compiler";
import { unzipSync, strFromU8 } from "fflate";
import { createPackage, normaliseAssetPath } from "./packager.js";

test("Create package from compiled story", async () => {
    const script = "Hello world!";
    const compileResult = await compile({ script });

    if (!compileResult.success) {
        throw new Error("Compile failed");
    }

    const pkg = await createPackage(compileResult, false);

    expect(pkg.files).toBeDefined();
    expect(pkg.files["index.html"]).toBeDefined();
    expect(pkg.files["style.css"]).toBeDefined();
    expect(pkg.files["story.js"]).toBeDefined();
    expect(pkg.files["squiffy.runtime.global.js"]).toBeDefined();

    // Check that story.js contains the compiled output
    expect(pkg.files["story.js"]).toContain("Hello world!");

    // Check that HTML contains expected elements
    expect(pkg.files["index.html"]).toContain("<html");
    expect(pkg.files["index.html"]).toContain("</html>");
    expect(pkg.files["index.html"]).toContain("squiffy.runtime.global.js");
    expect(pkg.files["index.html"]).toContain("story.js");

    // Should not create zip when createZip is false
    expect(pkg.zip).toBeUndefined();
});

test("Create package with zip", async () => {
    const script = "Test story";
    const compileResult = await compile({ script });

    if (!compileResult.success) {
        throw new Error("Compile failed");
    }

    const pkg = await createPackage(compileResult, true);

    expect(pkg.zip).toBeDefined();
    expect(pkg.zip).toBeInstanceOf(Uint8Array);
    expect(pkg.zip!.length).toBeGreaterThan(0);
});

test("Package includes title in HTML", async () => {
    const script = `@title My Story

Hello world!`;
    const compileResult = await compile({ script });

    if (!compileResult.success) {
        throw new Error("Compile failed");
    }

    const pkg = await createPackage(compileResult, false);

    expect(pkg.files["index.html"]).toContain("<title>My Story</title>");
});

test("Package includes external scripts", async () => {
    const script = `@import external.js

Hello world!`;
    const compileResult = await compile({
        script,
        externalFiles: {
            getMatchingFilenames: async () => ["external.js"],
            getContent: async () => "// External script",
            getLocalFilename: (filename) => filename,
        },
    });

    if (!compileResult.success) {
        throw new Error("Compile failed");
    }

    const pkg = await createPackage(compileResult, false);

    expect(pkg.files["index.html"]).toContain('<script src="external.js"></script>');
});

test("Package includes external stylesheets", async () => {
    const script = `@import styles.css

Hello world!`;
    const compileResult = await compile({
        script,
        externalFiles: {
            getMatchingFilenames: async () => ["styles.css"],
            getContent: async () => "/* Styles */",
            getLocalFilename: (filename) => filename,
        },
    });

    if (!compileResult.success) {
        throw new Error("Compile failed");
    }

    const pkg = await createPackage(compileResult, false);

    expect(pkg.files["index.html"]).toContain('<link rel="stylesheet" href="styles.css"/>');
});

test("Package includes version info", async () => {
    const script = "Hello world!";
    const compileResult = await compile({ script });

    if (!compileResult.success) {
        throw new Error("Compile failed");
    }

    const pkg = await createPackage(compileResult, false);

    expect(pkg.files["index.html"]).toContain("Created with Squiffy");
    expect(pkg.files["index.html"]).toContain("https://squiffystory.com");
    expect(pkg.files["index.html"]).toContain("https://github.com/textadventures/squiffy");
});

test("Story.js includes compiler header", async () => {
    const script = "Hello world!";
    const compileResult = await compile({ script });

    if (!compileResult.success) {
        throw new Error("Compile failed");
    }

    const pkg = await createPackage(compileResult, false);

    expect(pkg.files["story.js"]).toContain("// Created with Squiffy");
    expect(pkg.files["story.js"]).toContain("// https://github.com/textadventures/squiffy");
});

test("Package all files are strings", async () => {
    const script = "Hello world!";
    const compileResult = await compile({ script });

    if (!compileResult.success) {
        throw new Error("Compile failed");
    }

    const pkg = await createPackage(compileResult, false);

    // Verify all files exist and are strings
    expect(Object.keys(pkg.files).length).toBe(4);

    for (const [filename, content] of Object.entries(pkg.files)) {
        expect(typeof content).toBe("string");
        // Most files should have content, though some template files might be minimal
        if (filename === "index.html" || filename === "story.js" || filename === "squiffy.runtime.global.js") {
            expect(content.length).toBeGreaterThan(0);
        }
    }
});

test("Create inline HTML package", async () => {
    const script = `@title Inline Story

Hello world!`;
    const compileResult = await compile({ script });

    if (!compileResult.success) {
        throw new Error("Compile failed");
    }

    const pkg = await createPackage(compileResult, { inlineHtml: true });

    // Should only have one file
    expect(Object.keys(pkg.files).length).toBe(1);
    expect(pkg.files["index.html"]).toBeDefined();

    // Should NOT have separate files
    expect(pkg.files["style.css"]).toBeUndefined();
    expect(pkg.files["story.js"]).toBeUndefined();
    expect(pkg.files["squiffy.runtime.global.js"]).toBeUndefined();

    const html = pkg.files["index.html"];

    // Should contain inline style
    expect(html).toContain("<style>");
    expect(html).toContain("</style>");

    // Should contain inline scripts with content (not src references)
    expect(html).not.toContain('src="squiffy.runtime.global.js"');
    expect(html).not.toContain('src="story.js"');
    expect(html).not.toContain('href="style.css"');

    // Should contain the story content inline
    expect(html).toContain("Hello world!");

    // Should contain the title
    expect(html).toContain("<title>Inline Story</title>");

    // Should contain squiffyRuntime (the runtime code)
    expect(html).toContain("squiffyRuntime");
});

test("Inline HTML package with zip", async () => {
    const script = "Test story";
    const compileResult = await compile({ script });

    if (!compileResult.success) {
        throw new Error("Compile failed");
    }

    const pkg = await createPackage(compileResult, { inlineHtml: true, createZip: true });

    expect(Object.keys(pkg.files).length).toBe(1);
    expect(pkg.zip).toBeDefined();
    expect(pkg.zip).toBeInstanceOf(Uint8Array);
});

const compileOrThrow = async (script: string) => {
    const compileResult = await compile({ script });
    if (!compileResult.success) {
        throw new Error("Compile failed");
    }
    return compileResult;
};

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const mp3Bytes = new Uint8Array([0x49, 0x44, 0x33]);

test("Package without assets has no asset options in HTML", async () => {
    const pkg = await createPackage(await compileOrThrow("Hello"), { inlineHtml: true, assets: {} });
    const html = pkg.files["index.html"];
    expect(html).not.toContain("ASSET_OPTIONS");
    expect(html).not.toContain("resolveAssetUrl: function");
    expect(html).not.toContain("squiffyAssetUrls");
    expect(html).toContain("storyId: window.location.pathname,\n            });");
});

test("Assets are added to the zip at their paths", async () => {
    const pkg = await createPackage(await compileOrThrow("![A cat](cat.png)"), {
        createZip: true,
        assets: { "cat.png": pngBytes, "./sounds\\meow.mp3": mp3Bytes },
    });

    // Assets aren't text files, so aren't in pkg.files
    expect(Object.keys(pkg.files).sort()).toEqual(["index.html", "squiffy.runtime.global.js", "story.js", "style.css"]);
    expect(pkg.files["index.html"]).not.toContain("resolveAssetUrl: function");

    const zip = unzipSync(pkg.zip!);
    expect(Object.keys(zip).sort()).toEqual(["cat.png", "index.html", "sounds/meow.mp3", "squiffy.runtime.global.js", "story.js", "style.css"]);
    expect(zip["cat.png"]).toEqual(pngBytes);
    expect(zip["sounds/meow.mp3"]).toEqual(mp3Bytes);
});

test("Generated files take precedence over assets with the same name", async () => {
    const pkg = await createPackage(await compileOrThrow("Hello"), {
        createZip: true,
        assets: { "index.html": pngBytes },
    });
    const zip = unzipSync(pkg.zip!);
    expect(strFromU8(zip["index.html"])).toContain("<html");
});

test("Inline HTML embeds assets as data URIs", async () => {
    const pkg = await createPackage(await compileOrThrow("![A cat](images/cat.png)"), {
        inlineHtml: true,
        createZip: true,
        assets: { "images/cat.png": pngBytes, "meow.mp3": mp3Bytes },
    });
    const html = pkg.files["index.html"];
    expect(html).toContain('"images/cat.png":"data:image/png;base64,iVBORw0KGgo="');
    expect(html).toContain('"meow.mp3":"data:audio/mpeg;base64,SUQz"');
    expect(html).toContain("resolveAssetUrl: function (path)");

    // The zip only has the single HTML file
    expect(Object.keys(unzipSync(pkg.zip!))).toEqual(["index.html"]);
});

test("Inline HTML resolveAssetUrl maps paths to data URIs", async () => {
    const pkg = await createPackage(await compileOrThrow("Hello"), {
        inlineHtml: true,
        assets: { "cat.png": pngBytes },
    });
    const html = pkg.files["index.html"];
    const assetScript = html.match(/var squiffyAssetUrls = (.*);/)![1];
    const resolverSource = html.match(/resolveAssetUrl: (function \(path\) \{.*\}),/)![1];
    const resolve = new Function("squiffyAssetUrls", `return ${resolverSource};`)(JSON.parse(assetScript));
    expect(resolve("cat.png")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(resolve("./cat.png")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(resolve("dog.png")).toBe("dog.png");
});

test("Embedded asset data can't close the script element", async () => {
    const pkg = await createPackage(await compileOrThrow("Hello"), {
        inlineHtml: true,
        assets: { "</script>.png": pngBytes },
    });
    expect(pkg.files["index.html"]).toContain("\\u003c/script>.png");
});

test("Asset paths outside the package are rejected", () => {
    expect(normaliseAssetPath("./a/b.png")).toBe("a/b.png");
    expect(normaliseAssetPath("a\\b.png")).toBe("a/b.png");
    expect(() => normaliseAssetPath("../cat.png")).toThrow();
    expect(() => normaliseAssetPath("a/../../cat.png")).toThrow();
    expect(() => normaliseAssetPath("/etc/cat.png")).toThrow();
    expect(() => normaliseAssetPath("C:/cat.png")).toThrow();
});
