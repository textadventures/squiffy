import { expect, test } from "vitest";
import { compile } from "squiffy-compiler";
import { createPackage } from "./packager.js";

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
