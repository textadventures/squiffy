import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
    build: {
        target: "es2020",
        sourcemap: true,
        minify: "esbuild",
        lib: {
            entry: "src/packager.ts",
            formats: ["es"],
            fileName: 'packager'
        }
    },
    plugins: [
        dts({
            entryRoot: "src",
            outDir: "dist",
        })
    ],
});
