import { defineConfig } from "vitest/config";

export default defineConfig({
    // Not the tsconfig.json nearest each file: the story map's code from the editor (app/) would
    // pick up the editor's, which extends SvelteKit's generated one (see esbuild.mjs)
    tsconfig: "tsconfig.json",
});
