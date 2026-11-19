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
        info: () => {},
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

    test("imports wildcard matches in sorted order", async () => {
        await writeFiles({
            "main.js": "export { story } from \"./game.squiffy\";",
            "game.squiffy": "@import chapters/*.squiffy\n\n[[start]]:\nHello.\n",
            "chapters/c.squiffy": "[[c]]:\nC.\n",
            "chapters/a.squiffy": "[[a]]:\nA.\n",
            "chapters/B.squiffy": "[[b]]:\nB.\n",
        });

        expect(await getWatchFiles("game.squiffy")).toEqual(
            ["B", "a", "c"].map(name => path.join(root, "chapters", `${name}.squiffy`)));
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

    test("importing a project's main file builds every .squiffy file in its squiffy.json, and watches them", async () => {
        await writeFiles({
            "main.js": "export { story } from \"./story/game.squiffy\";",
            "story/squiffy.json": "{ \"version\": 1, \"main\": \"game.squiffy\", \"exclude\": [\"drafts/**\"] }",
            "story/game.squiffy": "[[start]]:\nGo to [[chapter1]].\n",
            "story/chapters/one.squiffy": "[[chapter1]]:\nChapter one.\n",
            "story/drafts/draft.squiffy": "[[draft]]:\nNot yet.\n",
        });

        const { js } = await buildEntry();
        const result = await importBundle(js);

        expect(Object.keys(result.story.sections)).toEqual(["start", "chapter1"]);
        expect(await getWatchFiles("story/game.squiffy")).toEqual([
            path.join(root, "story", "chapters", "one.squiffy"),
            path.join(root, "story", "squiffy.json"),
        ]);
    });

    test("a project's stylesheets and scripts are bundled without @imports", async () => {
        await writeFiles({
            "main.js": "export { story } from \"./story/game.squiffy\";",
            "story/squiffy.json": "{ \"version\": 1, \"main\": \"game.squiffy\" }",
            "story/game.squiffy": "[[start]]:\nHello.\n",
            "story/look.css": ".story-look { color: teal; }",
            "story/setup.js": "globalThis.storySetupRan = true;",
        });

        const { js, css } = await buildEntry();
        expect(css).toContain(".story-look");
        expect(js).toContain("storySetupRan");
    });

    test("Vite's output folder isn't part of a project", async () => {
        await writeFiles({
            "squiffy.json": "{ \"version\": 1, \"main\": \"game.squiffy\" }",
            "game.squiffy": "[[start]]:\nHello.\n",
            "dist/assets/index.js": "globalThis.oldBuild = true;",
            "app.js": "globalThis.app = true;",
        });
        const plugin = squiffyPlugin();
        (plugin.configResolved as (config: unknown) => void)({ root, build: { outDir: "dist" }, publicDir: "", configFile: undefined });
        const context = { addWatchFile: () => {}, warn: () => {}, info: () => {}, error: (message: string) => { throw new Error(message); } };
        const code = await (plugin.load as (this: typeof context, id: string) => Promise<string>).call(context, path.join(root, "game.squiffy"));
        expect(code).toContain("app.js");
        expect(code).not.toContain("dist/");
    });

    test("importing another file in a project's folder builds just that file", async () => {
        await writeFiles({
            "squiffy.json": "{ \"version\": 1, \"main\": \"game.squiffy\" }",
            "game.squiffy": "[[start]]:\nHello.\n",
            "other.squiffy": "[[other]]:\nOther.\n",
        });
        expect(await getWatchFiles("other.squiffy")).toEqual([]);
    });

    test("fails the build when squiffy.json needs a newer Squiffy", async () => {
        await writeFiles({
            "main.js": "export { story } from \"./game.squiffy\";",
            "squiffy.json": "{ \"version\": 99, \"main\": \"game.squiffy\" }",
            "game.squiffy": "[[start]]:\nHello.\n",
        });

        await expect(buildEntry()).rejects.toThrow(/needs a newer version of Squiffy/);
    });
});
