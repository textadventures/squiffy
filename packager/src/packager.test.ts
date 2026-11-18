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

test("Exported page has a light/dark button, and applies the saved choice before it's shown", async () => {
    const compileResult = await compile({ script: "Hello world!" });
    if (!compileResult.success) throw new Error("Compile failed");
    const html = (await createPackage(compileResult, false)).files["index.html"];

    expect(html).toContain('id="squiffy-theme"');
    // The saved choice is applied in <head>, before the stylesheets
    const head = html.substring(0, html.indexOf("</head>"));
    expect(head).toContain("localStorage.getItem('squiffy-theme:'");
    expect(head.indexOf("squiffyTheme")).toBeLessThan(head.indexOf('href="style.css"'));
});

test("Exported page has a Back button, unless it's turned off", async () => {
    const compileResult = await compile({ script: "Hello world!" });
    if (!compileResult.success) throw new Error("Compile failed");

    const html = (await createPackage(compileResult, {})).files["index.html"];
    expect(html).toContain('id="squiffy-back"');
    expect(html).not.toContain("BACK_BUTTON");
    // It's before Restart, and starts disabled until there's somewhere to go back to
    expect(html.indexOf('id="squiffy-back"')).toBeLessThan(html.indexOf('id="restart"'));
    expect(html).toMatch(/id="squiffy-back"[^>]*disabled/);

    const without = (await createPackage(compileResult, { backButton: false })).files["index.html"];
    expect(without).not.toContain('id="squiffy-back"');
    expect(without).not.toContain("BACK_BUTTON");
    expect(without).toContain('id="restart"');
});

test("Header buttons are labelled in English, or with the story's own strings", async () => {
    const compileResult = await compile({ script: "Hello {{back}}!" });
    if (!compileResult.success) throw new Error("Compile failed");

    const html = (await createPackage(compileResult, { inlineHtml: true })).files["index.html"];
    expect(html).toContain('id="squiffy-back" type="button" title="Back" aria-label="Back"');
    expect(html).toContain('title="Restart" aria-label="Restart" data-confirm="Are you sure you want to restart?"');
    expect(html).toContain('data-switch-to-dark="Switch to dark mode" data-switch-to-light="Switch to light mode"');
    // The story's own text is left alone
    expect(html).toContain("Hello {{back}}!");

    const french = (await createPackage(compileResult, {
        strings: { restart: "Recommencer", restartConfirm: "Voulez-vous vraiment recommencer ?", back: "\"<Retour>\" & 'co'" },
    })).files["index.html"];
    expect(french).toContain('title="Recommencer" aria-label="Recommencer" data-confirm="Voulez-vous vraiment recommencer ?"');
    expect(french).toContain('title="&#34;&#60;Retour&#62;&#34; &#38; &#39;co&#39;"');
    // Anything left out is in English
    expect(french).toContain('data-switch-to-dark="Switch to dark mode"');
    expect(french).not.toMatch(/\{\{\w+\}\}/);
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

// A story that @imports a stylesheet and a script, as the CLI and editor compile them
const compileWithImports = async (script: string, files: string[]) => {
    const compileResult = await compile({
        script,
        externalFiles: {
            getMatchingFilenames: async pattern => files.filter(f => f === pattern),
            getContent: async () => "",
            getLocalFilename: filename => filename,
        },
    });
    if (!compileResult.success) throw new Error("Compile failed");
    return compileResult;
};

const storyCss = "#squiffy { color: rebeccapurple; }";
const storyScript = "window.storyScriptRan = true;";
const encode = (text: string) => new TextEncoder().encode(text);

test("Inline HTML includes the story's own stylesheets and scripts", async () => {
    const result = await compileWithImports("@import my_style.css\n@import scripts/my_script.js\n\nHello", ["my_style.css", "scripts/my_script.js"]);
    const pkg = await createPackage(result, {
        inlineHtml: true,
        assets: { "my_style.css": encode(storyCss), "scripts/my_script.js": encode(storyScript), "cat.png": pngBytes },
    });
    const html = pkg.files["index.html"];

    expect(html).not.toContain('href="my_style.css"');
    expect(html).not.toContain('src="scripts/my_script.js"');
    expect(html).toContain(storyCss);
    expect(html).toContain(storyScript);

    // The story's styles come after Squiffy's, so they win
    expect(html.indexOf(storyCss)).toBeGreaterThan(html.indexOf("#squiffy-container"));
    // The story's script runs before the story starts, as it does from a separate file
    expect(html.indexOf(storyScript)).toBeLessThan(html.indexOf("squiffyRuntime.init"));

    // They're not embedded again as data URIs, but other assets still are
    expect(html).toContain('"cat.png":"data:image/png');
    expect(html).not.toContain('"my_style.css":');
    expect(html).not.toContain('"scripts/my_script.js":');
});

test("Inlined stylesheets and scripts can't close their elements", async () => {
    const result = await compileWithImports("@import a.css\n@import a.js\n\nHello", ["a.css", "a.js"]);
    const pkg = await createPackage(result, {
        inlineHtml: true,
        assets: { "a.css": encode("/* </style><b>css</b> */"), "a.js": encode("// </script><b>js</b>") },
    });
    const html = pkg.files["index.html"];
    expect(html).not.toContain("</style><b>css");
    expect(html).not.toContain("</script><b>js");
    expect(html).toContain("<\\/style><b>css");
    expect(html).toContain("<\\/script><b>js");
});

test("Inline HTML still links to a stylesheet or script it wasn't given", async () => {
    const result = await compileWithImports("@import my_style.css\n@import my_script.js\n\nHello", ["my_style.css", "my_script.js"]);
    const html = (await createPackage(result, { inlineHtml: true })).files["index.html"];
    expect(html).toContain('<link rel="stylesheet" href="my_style.css"/>');
    expect(html).toContain('<script src="my_script.js"></script>');
});

test("Multi-file packages link to the story's own stylesheets and scripts", async () => {
    const result = await compileWithImports("@import my_style.css\n@import my_script.js\n\nHello", ["my_style.css", "my_script.js"]);
    const pkg = await createPackage(result, {
        createZip: true,
        assets: { "my_style.css": encode(storyCss), "my_script.js": encode(storyScript) },
    });
    const html = pkg.files["index.html"];
    expect(html).toContain('<link rel="stylesheet" href="my_style.css"/>');
    expect(html).toContain('<script src="my_script.js"></script>');
    expect(html).not.toContain(storyCss);
    const zip = unzipSync(pkg.zip!);
    expect(strFromU8(zip["my_style.css"])).toBe(storyCss);
    expect(strFromU8(zip["my_script.js"])).toBe(storyScript);
});
