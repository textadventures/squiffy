import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { build, type Rollup } from "vite";
import fs from "fs/promises";
import os from "os";
import path from "path";
import squiffyPlugin from "./index.js";

let root: string;

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "vite-plugin-squiffy-"));
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
});

const writeFiles = async (files: Record<string, string>) => {
    for (const [name, content] of Object.entries(files)) {
        await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
        await fs.writeFile(path.join(root, name), content);
    }
};

// Builds main.js and returns the bundled JS and CSS
const buildEntry = async () => {
    const output = await build({
        root,
        logLevel: "silent",
        configFile: false,
        plugins: [squiffyPlugin()],
        build: {
            write: false,
            minify: false,
            lib: { entry: path.join(root, "main.js"), formats: ["es"], fileName: "main" },
        },
    }) as Rollup.RollupOutput[];

    const outputs = output.flatMap(o => o.output);
    const js = outputs.filter(o => o.type === "chunk").map(o => o.code).join("\n");
    const css = outputs.filter(o => o.type === "asset" && o.fileName.endsWith(".css"))
        .map(o => (o as Rollup.OutputAsset).source.toString()).join("\n");
    return { js, css };
};

// Calls the plugin's load hook directly, returning the files it asked Vite to watch
const getWatchFiles = async (filename: string) => {
    const watchFiles: string[] = [];
    const context = {
        addWatchFile: (file: string) => watchFiles.push(file),
        warn: () => {},
        error: (message: string) => { throw new Error(message); },
    };
    const load = squiffyPlugin().load as (this: typeof context, id: string) => Promise<string>;
    await load.call(context, path.join(root, filename));
    return watchFiles;
};

// The bundle is an ES module, so import it to check what it exports
const importBundle = async (js: string) => {
    const file = path.join(root, "bundle.mjs");
    await fs.writeFile(file, js);
    return await import(file);
};

describe("vite-plugin-squiffy", () => {
    test("compiles a .squiffy import into a story object", async () => {
        await writeFiles({
            "main.js": "import game, { story, title } from \"./game.squiffy\"; export { game, story, title };",
            "game.squiffy": "@title My Game\n\n[[start]]:\nHello, [[world]]!\n\n[[world]]:\nThe end.\n",
        });

        const { js } = await buildEntry();
        const result = await importBundle(js);

        expect(result.title).toBe("My Game");
        expect(result.story.start).toBe("start");
        expect(Object.keys(result.story.sections)).toEqual(["start", "world"]);
        expect(result.game).toBe(result.story);
    });

    test("includes @import-ed .squiffy files and watches them", async () => {
        await writeFiles({
            "main.js": "export { story } from \"./game.squiffy\";",
            "game.squiffy": "@import chapters/*.squiffy\n\n[[start]]:\nGo to [[chapter1]].\n",
            "chapters/one.squiffy": "[[chapter1]]:\nChapter one.\n",
        });

        const { js } = await buildEntry();
        const result = await importBundle(js);

        expect(Object.keys(result.story.sections)).toContain("chapter1");
        expect(await getWatchFiles("game.squiffy")).toEqual([path.join(root, "chapters", "one.squiffy")]);
    });

    test("bundles @import-ed scripts and stylesheets", async () => {
        await writeFiles({
            "main.js": "export { story } from \"./game.squiffy\";",
            "game.squiffy": "@import extra.js\n@import style.css\n\n[[start]]:\nHello.\n",
            "extra.js": "globalThis.extraLoaded = true;",
            "style.css": ".from-story { color: red; }",
        });

        const { js, css } = await buildEntry();

        expect(js).toContain("globalThis.extraLoaded = true");
        expect(css).toContain(".from-story");
    });

    test("fails the build when the story has compile errors", async () => {
        await writeFiles({
            "main.js": "export { story } from \"./game.squiffy\";",
            "game.squiffy": "[orphan]:\nA passage with no section.\n",
        });

        await expect(buildEntry()).rejects.toThrow(/Failed to compile.*game\.squiffy/s);
    });
});
