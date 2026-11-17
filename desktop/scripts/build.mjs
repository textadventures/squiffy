// Bundles the main process and the preload script with esbuild. They're bundled, rather than
// compiled file by file, because the preload runs sandboxed: it can only require("electron"),
// so project-fs's bridge has to be inlined into it. The main process is an ES module; a
// sandboxed preload has to be CommonJS.
import { build } from "esbuild";

const common = {
    bundle: true,
    platform: "node",
    target: "node22",
    external: ["electron"],
    sourcemap: true,
    logLevel: "info",
};

await Promise.all([
    build({ ...common, entryPoints: ["src/main.ts"], outfile: "dist/main.js", format: "esm" }),
    build({ ...common, entryPoints: ["src/preload.ts"], outfile: "dist/preload.cjs", format: "cjs" }),
]);
