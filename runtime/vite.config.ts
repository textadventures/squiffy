import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
    build: {
        target: "es2020",
        sourcemap: true,
        minify: "esbuild",
        lib: {
            entry: "src/squiffy.runtime.ts",
            formats: ["es"],
            fileName: 'squiffy.runtime'
        }
    },
    plugins: [
        dts({
            entryRoot: "src",
            outDir: "dist",
        })
    ],
});
