import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

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
        })
    ]
});