// Builds the preview page (src/preview.main.ts) as a single self-contained HTML file,
// dist/squiffy.preview.html, which hosts load into a sandboxed iframe with srcdoc or use as a
// VS Code webview's html. It's self-contained because a sandboxed frame has an opaque origin,
// so it can't rely on loading anything from the host's server. Also builds the host helper,
// dist/preview-host.js, and dist/preview-html.js, which exports the page as a string.
// See preview-protocol.ts, and #307 for the spike results behind this.
import { defineConfig } from "vite";
import { build } from "esbuild";
import { readFileSync, rmSync, writeFileSync } from "fs";
import { resolve } from "path";

const template = (css: string, js: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Squiffy preview</title>
<style>
${css}
/* The preview scrolls the story within the frame, with the text centred as on the exported page */
html, body { height: 100%; }
div#squiffy-container { max-width: none; height: 100%; padding: 0; }
#squiffy, .squiffy-preview-story, .squiffy-preview-story > div { height: 100%; box-sizing: border-box; }
.squiffy-preview-story > div { padding: 1em max(1.25rem, calc((100% - var(--squiffy-max-width)) / 2)); }
/* The story's panels: their buttons above the story, and side panels to its right */
#squiffy { display: flex; flex-direction: column; }
.squiffy-preview-header { flex: none; padding: 0.5rem 0.75rem 0; font-family: system-ui, sans-serif; font-size: 0.875rem; text-align: right; }
.squiffy-preview-header:empty { display: none; }
.squiffy-preview-body { flex: 1; min-height: 0; display: flex; }
#squiffy .squiffy-preview-body > .squiffy-preview-story { flex: 1; min-width: 0; height: 100%; }
.squiffy-preview-body > aside.squiffy-panels-side { flex: none; width: var(--squiffy-side-width); box-sizing: border-box; overflow-y: auto; padding: 1em 1.25rem 1em 0; }
</style>
</head>
<body>
<div id="squiffy-container"><div id="squiffy"></div></div>
<script>
${js.replace(/<\/(script)/gi, "<\\/$1")}
</script>
</body>
</html>
`;

export default defineConfig({
    build: {
        target: "es2020",
        minify: "esbuild",
        emptyOutDir: false,
        outDir: "dist/preview-build",
        lib: {
            entry: "src/preview.main.ts",
            name: "squiffyPreview",
            formats: ["iife"],
            fileName: () => "squiffy.preview.js",
        },
    },
    plugins: [
        {
            name: "inline-preview-page",
            async closeBundle() {
                const js = readFileSync(resolve("dist/preview-build/squiffy.preview.js"), "utf8");
                // The same styles as an exported story's page
                const css = readFileSync(resolve("src/squiffy.runtime.css"), "utf8") + "\n"
                    + readFileSync(resolve("src/squiffy.page.css"), "utf8");
                const html = template(css, js);
                writeFileSync(resolve("dist/squiffy.preview.html"), html);
                writeFileSync(resolve("dist/preview-html.js"),
                    `// The Squiffy preview page, built from squiffy-runtime's src/preview.main.ts\nexport const previewHtml = ${JSON.stringify(html)};\n`);
                writeFileSync(resolve("dist/preview-html.d.ts"),
                    "/** The Squiffy preview page, as HTML to use with setUpPreviewFrame() from squiffy-runtime/preview-host. */\nexport declare const previewHtml: string;\n");
                rmSync(resolve("dist/preview-build"), { recursive: true, force: true });

                await build({
                    entryPoints: [resolve("src/preview-host.ts")],
                    bundle: true,
                    format: "esm",
                    target: "es2020",
                    outfile: resolve("dist/preview-host.js"),
                    sourcemap: true,
                });
            },
        },
    ],
});
