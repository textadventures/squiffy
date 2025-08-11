// @ts-check
import {defineConfig} from 'astro/config';
import mdx from '@astrojs/mdx';
import starlight from '@astrojs/starlight';
import { astroExpressiveCode } from "@astrojs/starlight/expressive-code";

// https://astro.build/config
export default defineConfig({
    trailingSlash: "always",
    integrations: [
        astroExpressiveCode(),
        mdx(),
        starlight({
            title: 'Squiffy'
        })],
    markdown: {
        shikiConfig: {
            theme: 'catppuccin-latte'
        }
    }
});