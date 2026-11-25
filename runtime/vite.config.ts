import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { copyFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { noSourceMap } from "./vite.no-source-map";

export default defineConfig({
    build: {
        target: "es2020",
        sourcemap: true,
        minify: "esbuild",

        lib: {
            entry: "src/squiffy.runtime.ts",
            name: "squiffyRuntime"
        },

        rollupOptions: {
            output: [
                {
                    format: "es",
                    entryFileNames: "squiffy.runtime.js"
                },
                {
                    format: "iife",
                    name: "squiffyRuntime",
                    entryFileNames: "squiffy.runtime.global.js"
                }
            ]
        }
    },

    plugins: [
        noSourceMap,
        dts({
            entryRoot: "src",
            outDir: "dist"
        }),
        {
            name: "copy-css",
            closeBundle() {
                try {
                    mkdirSync("dist", { recursive: true });
                    for (const file of ["squiffy.runtime.css", "squiffy.page.css"]) {
                        copyFileSync(resolve("src", file), resolve("dist", file));
                    }
                } catch (err) {
                    console.error("Failed to copy CSS file:", err);
                }
            }
        }
    ]
});