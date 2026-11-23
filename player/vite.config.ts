import { defineConfig } from "vite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// All packages in this repo share one version, kept in the root package.json. The player is
// served from a folder named for its major version (/v7/), which is in every link to a story, so
// a story goes on being played by the version of Squiffy it was written for.
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version as string;
const folder = `v${version.split(".")[0]}`;

const home = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Squiffy stories</title>
<style>
:root { color-scheme: light dark; }
body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 20vh auto 0; padding: 0 1.25rem; line-height: 1.5; }
</style>
</head>
<body>
<h1>Squiffy stories</h1>
<p>This is where stories shared as links from <a href="https://squiffystory.com">Squiffy</a> are played. The story is in the link itself, so there's nothing to see here without one.</p>
</body>
</html>
`;

// For Cloudflare Pages. There's no Content-Security-Policy: the story's frame is a srcdoc one,
// which takes its policy from this page, so one strict enough to mean anything here would stop
// stories loading their own images, fonts and scripts. The frame's sandbox is what keeps a story
// away from this page. The player page itself only ever puts text into the document.
const headers = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Robots-Tag: noindex

# Each version's page is checked for a new build on every load. Its files have a hash in their names.
/:version/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;

export default defineConfig({
    base: `/${folder}/`,
    build: {
        target: "es2022",
        outDir: `build/${folder}`,
        emptyOutDir: true,
    },
    server: {
        port: Number(process.env.PORT) || 5181,
        strictPort: true,
    },
    plugins: [
        {
            name: "home-page",
            apply: "build",
            closeBundle() {
                mkdirSync("build", { recursive: true });
                writeFileSync("build/index.html", home);
                writeFileSync("build/_headers", headers);
            },
        },
    ],
});
