// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import starlight from "@astrojs/starlight";
import { appLinks } from "./src/app-links.mjs";
import { betaSite, siteUrl } from "./src/channel.mjs";
import squiffyGrammar from "squiffy-compiler/squiffy.tmLanguage.json" with { type: "json" };
import javascript from "shiki/langs/javascript.mjs";

// https://astro.build/config
export default defineConfig({
    site: siteUrl,
    trailingSlash: "always",
    integrations: [
        starlight({
            title: "Squiffy",
            logo: {
                src: "./src/assets/squiffy.png",
            },
            favicon: "/squiffy.png",
            // Configured here rather than as a separate astroExpressiveCode() integration, so Starlight
            // applies its own preset, which switches code blocks between light and dark with the site.
            expressiveCode: {
                shiki: {
                    // Highlights ```squiffy code blocks, with the grammar the compiler package exports.
                    // Its JavaScript blocks need Shiki's JavaScript grammar loaded alongside it.
                    langs: [...javascript, { ...squiffyGrammar, name: "squiffy", embeddedLangs: ["javascript"] }],
                },
            },
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
        // After Starlight, which adds Expressive Code, so that it highlights the MDX pages' code blocks too
        mdx(),
        appLinks(),
    ],
    markdown: {
        shikiConfig: {
            theme: "catppuccin-latte"
        }
    }
});