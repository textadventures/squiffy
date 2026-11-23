// Bundles the extension and its language server, for VS Code on the desktop (Node) and on the
// web (vscode.dev and github.dev, where the server runs in a Web Worker). Also copies in the
// grammar and the preview page from the compiler and runtime packages, so the extension is
// self-contained: it's packaged with --no-dependencies.
import { build, context } from "esbuild";
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

if (watch) {
    for (const config of configs) await (await context(config)).watch();
}
else {
    await Promise.all(configs.map(config => build(config)));
}
