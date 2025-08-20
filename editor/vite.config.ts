import {VitePWA} from 'vite-plugin-pwa';
import {defineConfig} from 'vite';
import inject from "@rollup/plugin-inject";
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
    resolve: {
        alias: {
            '~bootstrap': path.resolve(__dirname, 'node_modules/bootstrap'),
        }
    },
    plugins: [
        inject({
            $: "jquery",
            jQuery: "jquery",
        }),
        VitePWA({
            registerType: 'autoUpdate',
            injectRegister: 'auto',

            pwaAssets: {
                disabled: false,
                config: true,
            },

            manifest: {
                name: 'Squiffy',
                short_name: 'squiffy',
                description: 'Squiffy',
                theme_color: '#ffffff',
            },

            workbox: {
                globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
                cleanupOutdatedCaches: true,
                clientsClaim: true,
            },

            devOptions: {
                enabled: true,
                navigateFallback: 'index.html',
                suppressWarnings: true,
                type: 'module',
            },
        })],
})