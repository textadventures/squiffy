// Points a beta build's editor links at the beta editor. The docs link to app.squiffystory.com in
// many places (Markdown pages, the home page's hero, the footer), so rather than threading a
// variable through each, this rewrites the links in the built HTML once the build is done. Only
// href attributes change: link text such as "app.squiffystory.com" is left as it is. The same goes
// for the Markdown links in llms.txt and the other files for AI agents (see llms-txt.mjs).

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { appUrl, stableAppUrl } from "./channel.mjs";

/** @returns {import("astro").AstroIntegration} */
export function appLinks() {
    return {
        name: "squiffy-app-links",
        hooks: {
            "astro:build:done": ({ dir, logger }) => {
                if (appUrl === stableAppUrl) return;
                const rewrites = {
                    ".html": [`href="${stableAppUrl}`, `href="${appUrl}`],
                    ".txt": [`](${stableAppUrl}`, `](${appUrl}`],
                };
                let count = 0;
                const walk = (/** @type {string} */ folder) => {
                    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
                        const file = path.join(folder, entry.name);
                        if (entry.isDirectory()) {
                            walk(file);
                        } else {
                            const rewrite = rewrites[path.extname(entry.name)];
                            if (!rewrite) continue;
                            const [from, to] = rewrite;
                            const text = fs.readFileSync(file, "utf8");
                            if (text.includes(from)) {
                                fs.writeFileSync(file, text.replaceAll(from, to));
                                count++;
                            }
                        }
                    }
                };
                walk(fileURLToPath(dir));
                logger.info(`Pointed editor links at ${appUrl} in ${count} file(s)`);
            },
        },
    };
}
