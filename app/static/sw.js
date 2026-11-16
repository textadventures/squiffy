/* global self, caches */
// Retires the 6.x editor's service worker. That editor registered /sw.js (Workbox), which serves
// its own cached copy of the editor, so without this, anyone who'd used it would keep getting
// the 6.x editor. The browser checks /sw.js for an update on each visit and finds this instead,
// which clears the 6.x caches, unregisters itself and reloads the page into this editor (which
// registers its own worker, /service-worker.js).
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", event => {
    event.waitUntil((async () => {
        for (const key of await caches.keys()) {
            if (!key.startsWith("squiffy-app-")) await caches.delete(key);
        }
        await self.registration.unregister();
        for (const client of await self.clients.matchAll({ type: "window" })) {
            client.navigate(client.url);
        }
    })());
});
