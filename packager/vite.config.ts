import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { defineConfig, type Plugin } from "vite";
import dts from "vite-plugin-dts";

// Squiffy's own stylesheets go into every published story, so they're minified as the story's
// JavaScript is: authors change how a story looks with a stylesheet of their own, which is
// published as they wrote it. The runtime's dist/ keeps the readable copies, for anyone who
// embeds Squiffy in their own page.
const minifySquiffyCss = (): Plugin => ({
    name: "minify-squiffy-css",
    enforce: "pre",
    load(id) {
        const [path, query] = id.split("?");
        if (query !== "raw" || !/[\\/]squiffy\.(runtime|page)\.css$/.test(path)) return null;
        this.addWatchFile(path);
        const css = transformSync(readFileSync(path, "utf8"), { loader: "css", minify: true }).code;
        return `export default ${JSON.stringify(css)};`;
    }
});

export default defineConfig({
    build: {
        target: "es2020",
        sourcemap: true,
        minify: "esbuild",
        lib: {
            entry: "src/packager.ts",
            formats: ["es"],
            fileName: "packager"
        }
    },
    // Vitest empties CSS imports unless they're included here
    test: {
        css: { include: /[\\/]squiffy\.(runtime|page)\.css\?raw$/ }
    },
    plugins: [
        minifySquiffyCss(),
        dts({
            entryRoot: "src",
            outDir: "dist",
        })
    ],
});
