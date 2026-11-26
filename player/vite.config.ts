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

// What a story in the player can reach, so that a story shared as a link can't pass
// itself off as another site. The story's frame is a srcdoc one, which takes this page's policy.
// - frame-src and object-src: nothing can be loaded into a frame, so a story can't put another
//   site, such as a fake sign-in page, in its frame, under squiffystories.com's address, by
//   navigating it, a <meta http-equiv="refresh">, or an <iframe> or <object> of its own. The srcdoc
//   frame itself isn't loaded from anywhere, so it isn't stopped. Its links to other sites open in
//   a new tab instead (openOtherSitesInNewTab in squiffy-runtime's preview.ts).
// - connect-src: no fetch(), WebSockets and the like, which a story has no need of, so it can't
//   send what a reader types to a server of its choosing, except in the address of an image.
// - form-action: no forms are sent (the frame's sandbox stops them too).
// Images, sounds and fonts from other sites are allowed, as stories use them, and so are scripts
// (the story's own run from blob: URLs). The frame's sandbox is what keeps a story away from this
// page, its storage, and the reader's tab. The player page itself only ever puts text into the
// document.
const policy = (connect: string) => ["frame-src 'none'", "object-src 'none'", `connect-src ${connect}`, "form-action 'none'"].join("; ");
const CONTENT_SECURITY_POLICY = policy("'none'");
// The dev server's page needs its WebSocket, for hot reloading, which 'self' covers. Not ws:,
// which WebKit takes to allow http: as well.
const DEV_CONTENT_SECURITY_POLICY = policy("'self'");

// For Cloudflare Pages. A path that matches more than one rule gets the headers of each, so the
// play page has both Content-Security-Policy headers, and a browser enforces both.
const headers = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Robots-Tag: noindex
  Content-Security-Policy: ${CONTENT_SECURITY_POLICY}

# The play page, which the editor's Play in a new tab sends a story to (src/play.ts), is only ever
# a tab of its own, so no other site can put it in a frame
/:version/play
  Content-Security-Policy: frame-ancestors 'none'
  X-Frame-Options: DENY

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
        rollupOptions: {
            // The player, and the play page for the editor's Play in a new tab (src/play.ts)
            input: { main: "index.html", play: "play.html" },
        },
    },
    server: {
        port: Number(process.env.PORT) || 5181,
        strictPort: true,
        headers: { "Content-Security-Policy": DEV_CONTENT_SECURITY_POLICY },
    },
    preview: {
        headers: { "Content-Security-Policy": CONTENT_SECURITY_POLICY },
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
