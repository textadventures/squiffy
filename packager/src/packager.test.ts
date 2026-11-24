import { expect, test } from "vitest";
import { compile, PAGE_STRINGS } from "squiffy-compiler";
import { SAVES_STRINGS, SETTINGS_STRINGS } from "squiffy-runtime";
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
    expect(head).toContain("const themeKey = 'squiffy-theme:' + window.squiffyStorageKey;");
    expect(head.indexOf("squiffyTheme")).toBeLessThan(head.indexOf('href="style.css"'));
});

test("Exported page shows the story's panels, with the page's strings", async () => {
    const compileResult = await compile({ script: "[[]]:\n\n[status]:\nHello", panels: [{ passage: "status", label: "Status", position: "side" }] });
    if (!compileResult.success) throw new Error("Compile failed");
    const pkg = await createPackage(compileResult, { strings: { close: "Fermer" } });
    expect(pkg.files["story.js"]).toContain("story.panels = [");
    const html = pkg.files["index.html"];
    expect(html).toContain("squiffyRuntime.createPanels(squiffyApi, {");
    // The strings are given once, for both the Saved games dialog and the panels
    expect(html).not.toContain("/* PAGE_STRINGS */");
    expect(html.match(/const pageStrings = \{[^\n]*"close":"Fermer"/)).not.toBeNull();
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

test("Exported page has a place for a title at the left of its header, which the runtime fills", async () => {
    const compileResult = await compile({ script: "Hello world!" });
    if (!compileResult.success) throw new Error("Compile failed");

    const html = (await createPackage(compileResult, {})).files["index.html"];
    // Hidden until there's a title, and first in the header
    expect(html).toMatch(/<div id="squiffy-header">\s*<span id="squiffy-header-title" hidden><\/span>/);
    expect(html).toContain("showHeaderTitle(squiffyApi.headerTitle());");
    expect(html).toContain("squiffyApi.on('headerTitleChanged'");
});

test("Exported page only lets anyone start at any section when it's asked to", async () => {
    const compileResult = await compile({ script: "Hello world!" });
    if (!compileResult.success) throw new Error("Compile failed");

    const html = (await createPackage(compileResult, {})).files["index.html"];
    expect(html).not.toContain("START_ANYWHERE");
    expect(html).toContain("if (false && window.location.protocol !== 'blob:') {");
    expect(html).toContain("await squiffyApi.begin(startAt);");

    const testing = (await createPackage(compileResult, { startAnywhere: true })).files["index.html"];
    expect(testing).toContain("if (true && window.location.protocol !== 'blob:') {");
});

test("Exported page has a Save button, which opens the Saved games dialog, unless it's turned off", async () => {
    const compileResult = await compile({ script: "Hello world!" });
    if (!compileResult.success) throw new Error("Compile failed");

    const html = (await createPackage(compileResult, {})).files["index.html"];
    expect(html).toContain('id="squiffy-saves-button" type="button" title="Saved games" aria-label="Saved games"');
    expect(html).not.toContain("SAVE_BUTTON");
    expect(html.indexOf('id="squiffy-saves-button"')).toBeLessThan(html.indexOf('id="restart"'));
    expect(html).toContain("squiffyRuntime.createSavesDialog(squiffyApi");
    expect(html).not.toContain("/* PAGE_STRINGS */");

    const without = (await createPackage(compileResult, { saveButton: false })).files["index.html"];
    expect(without).not.toContain('id="squiffy-saves-button"');
    expect(without).not.toContain("SAVE_BUTTON");
});

test("The Saved games dialog gets the page's strings, safely", async () => {
    const compileResult = await compile({ script: "Hello world!" });
    if (!compileResult.success) throw new Error("Compile failed");

    const html = (await createPackage(compileResult, {
        strings: { save: "Sauvegarder", load: "</script><b>" },
    })).files["index.html"];
    const json = /const pageStrings = (\{.*\});\n/.exec(html)![1];
    expect(json).not.toContain("</script>");
    const strings = JSON.parse(json);
    expect(strings.save).toBe("Sauvegarder");
    expect(strings.load).toBe("</script><b>");
    expect(strings.saves).toBe("Saved games");
});

test("The runtime's Saved games dialog has the same English as PAGE_STRINGS", () => {
    for (const [name, text] of Object.entries(SAVES_STRINGS)) {
        expect(PAGE_STRINGS[name as keyof typeof PAGE_STRINGS], name).toBe(text);
    }
});

test("Exported page has a Settings button, which it shows for a story with settings (#452)", async () => {
    const compileResult = await compile({ script: "Hello world!", settings: [{ name: "warnings", label: "Warnings", type: "toggle" }] });
    if (!compileResult.success) throw new Error("Compile failed");

    const html = (await createPackage(compileResult, { strings: { settings: "Réglages" } })).files["index.html"];
    expect(html).toContain('id="squiffy-settings-button" type="button" title="Réglages" aria-label="Réglages" aria-haspopup="dialog" hidden');
    expect(html).toContain("settingsButton.hidden = !(story.settings && story.settings.length);");
    expect(html).toContain("squiffyRuntime.createSettingsDialog(squiffyApi");
    expect(html).toContain("squiffyApi.on('settingsRequested', openSettings);");
    expect(compileResult.output.story.settings).toHaveLength(1);
});

test("The runtime's Settings dialog has the same English as PAGE_STRINGS", () => {
    for (const [name, text] of Object.entries(SETTINGS_STRINGS)) {
        expect(PAGE_STRINGS[name as keyof typeof PAGE_STRINGS], name).toBe(text);
    }
});

test("Header buttons are labelled in English, or with the story's own strings", async () => {
    const compileResult = await compile({ script: "Hello {{back}}!" });
    if (!compileResult.success) throw new Error("Compile failed");

    const html = (await createPackage(compileResult, { inlineHtml: true })).files["index.html"];
    expect(html).toContain('id="squiffy-back" type="button" title="Back" aria-label="Back"');
    expect(html).toContain('title="Restart" aria-label="Restart"');
    // The question the Restart button asks, in the page's script
    expect(html).toContain('"restartConfirm":"Are you sure you want to restart?"');
    expect(html).toContain('data-switch-to-dark="Switch to dark mode" data-switch-to-light="Switch to light mode"');
    // The mute button (#444), which the page shows if the story has music or sounds
    expect(html).toContain('id="squiffy-mute" type="button" data-mute="Mute" data-unmute="Unmute" hidden');
    // The story's own text is left alone
    expect(html).toContain("Hello {{back}}!");

    const french = (await createPackage(compileResult, {
        strings: { restart: "Recommencer", restartConfirm: "Voulez-vous vraiment recommencer ?", back: "\"<Retour>\" & 'co'" },
    })).files["index.html"];
    expect(french).toContain('title="Recommencer" aria-label="Recommencer"');
    expect(french).toContain('"restartConfirm":"Voulez-vous vraiment recommencer ?"');
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
    expect(html).toContain("strings: pageStrings,\n            });");
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

test("Inline HTML embeds the files an included stylesheet's url()s refer to", async () => {
    const fontBytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32]);
    const css = `@font-face { font-family: "Story"; src: url("latin-400-normal.woff2") format("woff2"); }
body { background: url(../../bg.png); }
a { background: url(https://example.com/x.png); }`;
    const result = await compileWithImports("@import fonts/story/story.css\n\nHello", ["fonts/story/story.css"]);
    const pkg = await createPackage(result, {
        inlineHtml: true,
        assets: { "fonts/story/story.css": encode(css), "fonts/story/latin-400-normal.woff2": fontBytes, "bg.png": pngBytes },
    });
    const html = pkg.files["index.html"];

    expect(html).toContain('src: url("data:font/woff2;base64,d09GMg==") format("woff2")');
    expect(html).toContain('background: url("data:image/png;base64,');
    expect(html).toContain("url(https://example.com/x.png)");
    // The font is only for the stylesheet, but the image could be in the story too
    expect(html).not.toContain('"fonts/story/latin-400-normal.woff2":');
    expect(html).toContain('"bg.png":"data:image/png');
});

test("A zip links to a stylesheet, whose url()s find the files beside it", async () => {
    const result = await compileWithImports("@import fonts/story/story.css\n\nHello", ["fonts/story/story.css"]);
    const pkg = await createPackage(result, {
        createZip: true,
        assets: { "fonts/story/story.css": encode("src: url(\"a.woff2\");"), "fonts/story/a.woff2": new Uint8Array([1]) },
    });
    expect(pkg.files["index.html"]).toContain('<link rel="stylesheet" href="fonts/story/story.css"/>');
    const zip = unzipSync(pkg.zip!);
    expect(Object.keys(zip)).toEqual(expect.arrayContaining(["fonts/story/story.css", "fonts/story/a.woff2"]));
});

// The <head> part of a page
const headOf = (html: string) => html.substring(0, html.indexOf("</head>"));

test("Exported page's <head> says what the story is: its IFID, description, author and cover", async () => {
    const compileResult = await compile({ script: "@title The Cave\n\nHello" });
    if (!compileResult.success) throw new Error("Compile failed");
    const options = { id: "0b7c6d9e-3f1a-4e2b-9c5d-8a7f6e5d4c3b", description: "A short story about a cave.", author: "Ann Author", cover: "images/cover.png" };
    const pkg = await createPackage(compileResult, { ...options, createZip: true, assets: { "images/cover.png": new Uint8Array([1]) } });
    const head = headOf(pkg.files["index.html"]);
    expect(head).toContain("<head prefix=\"ifiction: http://babel.ifarchive.org/protocol/iFiction/\">");
    expect(head).toContain("<meta property=\"ifiction:ifid\" content=\"0B7C6D9E-3F1A-4E2B-9C5D-8A7F6E5D4C3B\">");
    expect(head).toContain("<title>The Cave</title>");
    expect(head).toContain("<meta name=\"description\" content=\"A short story about a cave.\">");
    expect(head).toContain("<meta name=\"author\" content=\"Ann Author\">");
    expect(head).toContain("<meta property=\"og:type\" content=\"website\">");
    expect(head).toContain("<meta property=\"og:title\" content=\"The Cave\">");
    expect(head).toContain("<meta property=\"og:description\" content=\"A short story about a cave.\">");
    expect(head).toContain("<meta property=\"og:image\" content=\"images/cover.png\">");
    expect(head).toContain("<meta name=\"twitter:card\" content=\"summary\">");
    // The zip's index.html is the same page, and has the cover beside it
    const zip = unzipSync(pkg.zip!);
    expect(strFromU8(zip["index.html"])).toBe(pkg.files["index.html"]);
    expect(zip["images/cover.png"]).toBeDefined();
    // So does a single HTML file, except for the cover, which it has nowhere to put
    const single = headOf((await createPackage(compileResult, { ...options, inlineHtml: true })).files["index.html"]);
    expect(single).toContain("<meta property=\"ifiction:ifid\" content=\"0B7C6D9E-3F1A-4E2B-9C5D-8A7F6E5D4C3B\">");
    expect(single).toContain("<meta name=\"author\" content=\"Ann Author\">");
    expect(single).not.toContain("og:image");
    expect(single).not.toContain("twitter:card");
});

test("Exported page leaves out the tags for details the story doesn't have", async () => {
    const compileResult = await compile({ script: "@title The Cave\n\nHello" });
    if (!compileResult.success) throw new Error("Compile failed");
    for (const options of [{}, { id: " ", description: "", author: "  ", cover: "" }]) {
        const head = headOf((await createPackage(compileResult, options)).files["index.html"]);
        expect(head).toContain("<head>");
        expect(head).not.toContain("prefix=");
        expect(head).not.toContain("ifiction:ifid");
        expect(head).not.toContain("name=\"description\"");
        expect(head).not.toContain("name=\"author\"");
        expect(head).not.toContain("og:description");
        expect(head).not.toContain("og:image");
        expect(head).not.toContain("twitter:card");
        // What it does have is its title
        expect(head).toContain("<meta property=\"og:title\" content=\"The Cave\">");
        expect(head).not.toContain("<!-- META -->");
    }
});

test("Exported page's <html> has the story's language", async () => {
    const compileResult = await compile({ script: "@title La Grotte\n\nBonjour" });
    if (!compileResult.success) throw new Error("Compile failed");
    for (const options of [{ language: "fr" }, { language: "fr", inlineHtml: true }]) {
        expect((await createPackage(compileResult, options)).files["index.html"]).toContain("<html lang=\"fr\">");
    }
    for (const options of [{}, { language: " " }]) {
        expect((await createPackage(compileResult, options)).files["index.html"]).toContain("<html>");
    }
});

test("Exported page's story details are escaped", async () => {
    const compileResult = await compile({ script: "@title Tom & \"Jerry\"\n\nHello" });
    if (!compileResult.success) throw new Error("Compile failed");
    const head = headOf((await createPackage(compileResult, {
        description: "<b>Bold</b> & \"quoted\" {{close}} $&", author: "O'Brien", cover: "a\"b.png", language: "x\"y",
    })).files["index.html"]);
    expect(head).toContain("<html lang=\"x&#34;y\">");
    expect(head).toContain("<meta name=\"description\" content=\"&#60;b&#62;Bold&#60;/b&#62; &#38; &#34;quoted&#34; {{close}} $&#38;\">");
    expect(head).toContain("<meta name=\"author\" content=\"O&#39;Brien\">");
    expect(head).toContain("<meta property=\"og:title\" content=\"Tom &#38; &#34;Jerry&#34;\">");
    expect(head).toContain("<meta property=\"og:image\" content=\"a&#34;b.png\">");
});

test("The page keeps the reader's progress under squiffy.json's id, or else the page's address", async () => {
    const withId = await compile({ script: "Hello", projectId: "0b7c6d9e-story" });
    const without = await compile({ script: "Hello" });
    if (!withId.success || !without.success) throw new Error("Compile failed");
    expect((await createPackage(withId, false)).files["index.html"]).toContain('window.squiffyStorageKey = "0b7c6d9e-story";');
    const html = (await createPackage(without, false)).files["index.html"];
    expect(html).toContain("window.squiffyStorageKey = window.location.pathname;");
    expect(html).toContain("key: window.squiffyStorageKey,");
    expect(html).not.toContain("STORAGE_KEY");
});
