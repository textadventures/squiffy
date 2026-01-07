import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { copyFileSync, mkdirSync } from "fs";
import { resolve } from "path";

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
        dts({
            entryRoot: "src",
            outDir: "dist"
        }),
        {
            name: "copy-css",
            closeBundle() {
                try {
                    mkdirSync("dist", { recursive: true });
                    copyFileSync(
                        resolve("src/squiffy.runtime.css"),
                        resolve("dist/squiffy.runtime.css")
                    );
                } catch (err) {
                    console.error("Failed to copy CSS file:", err);
                }
            }
        }
    ]
});