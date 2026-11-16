import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";

// Where the app is served from ("" at the root). Also exposed to the app as #lib/base-path's `base`.
const basePath = (process.env.BASE_PATH ?? "") as "" | `/${string}`;

// All packages in this repo share one version, kept in the root package.json
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version as string;

export default defineConfig({
    define: {
        __APP_BASE_PATH__: JSON.stringify(basePath),
        __APP_VERSION__: JSON.stringify(version),
    },
    plugins: [
        tailwindcss(),
        // SvelteKit 3 takes its config here; there's no svelte.config.js.
        sveltekit({
            preprocess: vitePreprocess(),
            adapter: adapter({ fallback: "index.html" }),
            paths: { base: basePath },
            version: { pollInterval: 0 },
            // Registered by #lib/updates, so a new version can wait for the update banner
            serviceWorker: { register: false },
        }),
    ],
    worker: {
        format: "es",
    },
    server: {
        port: Number(process.env.PORT) || 5180,
    },
});
