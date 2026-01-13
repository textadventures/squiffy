import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite";
import * as path from "node:path";
import { resolve } from "path";

// https://vitejs.dev/config/
export default defineConfig({
    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, "index.html"),
                preview: resolve(__dirname, "preview.html")
            }
        }
    },
    resolve: {
        alias: {
            "~bootstrap": path.resolve(__dirname, "node_modules/bootstrap"),
        }
    },
    // Silence deprecations for Bootstrap
    css: {
        preprocessorOptions: {
            scss: {
                api: "modern",
                silenceDeprecations: ["color-functions", "global-builtin", "import"]
            }
        }
    },
    plugins: [
        VitePWA({
            registerType: "prompt",
            injectRegister: false,

            pwaAssets: {
                disabled: false,
                config: true,
            },

            manifest: {
                name: "Squiffy",
                short_name: "squiffy",
                description: "Squiffy",
                theme_color: "#ffffff",
            },

            workbox: {
                globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2,ttf,otf}"],
                cleanupOutdatedCaches: true,
                clientsClaim: true,
            },

            devOptions: {
                enabled: true,
                navigateFallback: "index.html",
                suppressWarnings: true,
                type: "module",
            },
        })],
});