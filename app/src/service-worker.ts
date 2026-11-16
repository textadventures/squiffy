/// <reference lib="webworker" />
// Lets the editor work offline and be installed as an app, as the 6.x editor does. Every file of
// this version is cached when it installs. A new version waits until the page says to take
// over (the update banner's Reload), so a running editor never mixes files from two versions.
import { self as sw } from "$app/service-worker";
import { immutable, assets } from "$app/manifest";
import { version } from "$app/env";

const CACHE = `squiffy-app-${version}`;
// Full URLs: the manifest's paths are relative to where the app is served from. Cloudflare's
// own files (_headers) aren't served, and one missing file would fail the whole install.
const urls = () => new Set([...immutable, ...assets.filter(f => !f.path.startsWith("_"))]
    .map(f => new URL(f.path, sw.registration.scope).href));

sw.addEventListener("install", event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([...urls(), sw.registration.scope])));
});

sw.addEventListener("activate", event => {
    event.waitUntil((async () => {
        for (const key of await caches.keys()) {
            if (key !== CACHE) await caches.delete(key);
        }
        await sw.clients.claim();
    })());
});

sw.addEventListener("message", event => {
    if (event.data === "skip-waiting") void sw.skipWaiting();
});

sw.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET" || new URL(request.url).origin !== sw.location.origin) return;

    // A page: the network when there is one, else the app's own page (every route is the same
    // single page, which routes itself)
    if (request.mode === "navigate") {
        event.respondWith(fetch(request).catch(async () => {
            const cache = await caches.open(CACHE);
            return (await cache.match(sw.registration.scope, { ignoreVary: true })) ?? Response.error();
        }));
        return;
    }

    // This version's own files come from the cache. ignoreVary, since a file preloaded with CORS
    // sends an Origin header that the cached copy wasn't stored with. Files under _app/immutable
    // never change, so ones SvelteKit's list leaves out (chunks a worker loads, such as the
    // packager) are cached the first time they're fetched.
    const url = new URL(request.url);
    const immutableFile = url.pathname.startsWith(new URL("_app/immutable/", sw.registration.scope).pathname);
    if (urls().has(request.url) || immutableFile) {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE);
            const cached = await cache.match(request, { ignoreVary: true });
            if (cached) return cached;
            const response = await fetch(request);
            if (response.ok && immutableFile) await cache.put(request, response.clone());
            return response;
        })());
    }
});
