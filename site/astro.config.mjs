// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import starlight from "@astrojs/starlight";
import { astroExpressiveCode } from "@astrojs/starlight/expressive-code";
import { appLinks } from "./src/app-links.mjs";
import { betaSite, siteUrl } from "./src/channel.mjs";

// https://astro.build/config
export default defineConfig({
    site: siteUrl,
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
            // beta.squiffystory.com stays out of search results, so searches land on the docs for the
            // release people actually have.
            head: betaSite ? [{ tag: "meta", attrs: { name: "robots", content: "noindex" } }] : [],
            components: {
                Banner: "./src/components/Banner.astro",
                Header: "./src/components/Header.astro",
                PageFrame: "./src/components/PageFrame.astro",
            },
            social: [
                { icon: "github", label: "GitHub", href: "https://github.com/textadventures/squiffy" },
                { icon: "discord", label: "Discord", href: "https://textadventures.co.uk/community/discord" }
            ],
            editLink: {
                baseUrl: "https://github.com/textadventures/squiffy/edit/main/site/",
            },
        }),
        appLinks(),
    ],
    markdown: {
        shikiConfig: {
            theme: "catppuccin-latte"
        }
    }
});