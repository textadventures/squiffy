// Bundles the extension and its language server, for VS Code on the desktop (Node) and on the
// web (vscode.dev and github.dev, where the server runs in a Web Worker). Also copies in the
// grammar and the preview page from the compiler and runtime packages, so the extension is
// self-contained: it's packaged with --no-dependencies. The story map's webview (src/map/) is a
// Svelte page, so Vite builds that, into dist/map/.
import { build, context } from "esbuild";
import { build as viteBuild } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { copyFileSync, mkdirSync, rmSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const watch = process.argv.includes("--watch");

const common = {
    bundle: true,
    sourcemap: watch,
    minify: !watch,
    target: "es2022",
    logLevel: "info",
    // Not the tsconfig.json nearest each file: the story map's code from the editor (app/) would
    // pick up the editor's, which extends SvelteKit's generated one
    tsconfig: "tsconfig.json",
};

const configs = [
    // The extension, in the extension host
    { ...common, entryPoints: ["src/client/node.ts"], outfile: "dist/node/extension.js", platform: "node", format: "cjs", external: ["vscode"] },
    { ...common, entryPoints: ["src/client/web.ts"], outfile: "dist/web/extension.js", platform: "browser", format: "cjs", external: ["vscode"] },
    // The language server, in its own process, or a Web Worker
    { ...common, entryPoints: ["src/server/node.ts"], outfile: "dist/node/server.js", platform: "node", format: "cjs" },
    { ...common, entryPoints: ["src/server/web.ts"], outfile: "dist/web/server.js", platform: "browser", format: "iife" },
];

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
copyFileSync(require.resolve("squiffy-compiler/squiffy.tmLanguage.json"), "dist/squiffy.tmLanguage.json");

// The story map's page, as one script and one stylesheet, which the webview loads with asWebviewUri
const map = () => viteBuild({
    configFile: false,
    logLevel: "warn",
    tsconfig: "src/map/tsconfig.json",
    plugins: [svelte({ configFile: false })],
    build: {
        outDir: "dist/map",
        emptyOutDir: true,
        minify: !watch,
        sourcemap: watch,
        watch: watch ? {} : null,
        lib: { entry: "src/map/main.ts", formats: ["iife"], name: "squiffyMap", fileName: () => "map.js", cssFileName: "map" },
    },
});

if (watch) {
    for (const config of configs) await (await context(config)).watch();
    await map();
}
else {
    await Promise.all([...configs.map(config => build(config)), map()]);
}
