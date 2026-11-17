import { promises as fsp } from "node:fs";
import * as nodePath from "node:path";
import { protocol } from "electron";

// The editor is served from app://squiffy/, a privileged scheme of the app's own, rather than
// from file:// (where module workers and fetch don't work) or a loopback server. Quest Viva uses
// a loopback server on a random port, so its origin changes every launch, and it has to keep its
// settings in files instead of localStorage. A fixed origin keeps localStorage, IndexedDB and the
// rest as they are on the web.

export const APP_SCHEME = "app";
export const APP_ORIGIN = `${APP_SCHEME}://squiffy`;

const MIME_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".wasm": "application/wasm",
    ".txt": "text/plain; charset=utf-8",
};

/** Must be called before the app's ready event. */
export function registerAppScheme(): void {
    protocol.registerSchemesAsPrivileged([{
        scheme: APP_SCHEME,
        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
    }]);
}

/** Serves the editor's static build from `root`, with index.html for any route that isn't a file. */
export function handleAppScheme(root: string): void {
    const realRoot = nodePath.resolve(root);
    protocol.handle(APP_SCHEME, async (request) => {
        const url = new URL(request.url);
        if (url.host !== "squiffy") return new Response("Not found", { status: 404 });
        let pathname: string;
        try {
            pathname = decodeURIComponent(url.pathname);
        } catch {
            return new Response("Bad request", { status: 400 });
        }
        const file = nodePath.resolve(realRoot, "." + pathname);
        if (file !== realRoot && !file.startsWith(realRoot + nodePath.sep)) return new Response("Not found", { status: 404 });

        let target = file;
        if (!(await isFile(target))) {
            // A route of the single-page app: anything without an extension. A missing asset stays a 404.
            if (nodePath.extname(pathname)) return new Response("Not found", { status: 404 });
            target = nodePath.join(realRoot, "index.html");
        }
        const body = await fsp.readFile(target);
        return new Response(body, {
            headers: { "Content-Type": MIME_TYPES[nodePath.extname(target).toLowerCase()] ?? "application/octet-stream" },
        });
    });
}

async function isFile(path: string): Promise<boolean> {
    try {
        return (await fsp.stat(path)).isFile();
    } catch {
        return false;
    }
}
