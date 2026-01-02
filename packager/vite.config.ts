import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
    build: {
        target: "es2020",
        minify: "esbuild",
        lib: {
            entry: "src/packager.ts",
            formats: ["es"],
        }
    },
    plugins: [
        dts({
            entryRoot: "src",
            outDir: "dist",
        })
    ],
});
