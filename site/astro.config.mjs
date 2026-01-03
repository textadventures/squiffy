// @ts-check
import {defineConfig} from "astro/config";
import mdx from "@astrojs/mdx";
import starlight from "@astrojs/starlight";
import { astroExpressiveCode } from "@astrojs/starlight/expressive-code";

// https://astro.build/config
export default defineConfig({
    trailingSlash: "always",
    integrations: [
        astroExpressiveCode(),
        mdx(),
        starlight({
            title: "Squiffy",
            logo: {
                src: "./src/assets/squiffy.png",
            },
            favicon: "/squiffy.png",
            customCss: [
                "./src/styles/custom.css",
            ],
            social: [
                { icon: "github", label: "GitHub", href: "https://github.com/textadventures/squiffy" },
                { icon: "discord", label: "Discord", href: "https://textadventures.co.uk/community/discord" }
            ],
            editLink: {
                baseUrl: "https://github.com/textadventures/squiffy/edit/main/site/",
            },
        })],
    markdown: {
        shikiConfig: {
            theme: "catppuccin-latte"
        }
    }
});