// Registers the service worker (src/service-worker.ts) and says when a new version is waiting,
// for the update banner. Only in a built app: in development there's nothing to cache.
import { dev } from "$app/env";
import { base } from "./base-path.js";

export const update = $state({ waiting: null as ServiceWorker | null });

export async function registerServiceWorker() {
    if (dev || !("serviceWorker" in navigator)) return;
    let registration: ServiceWorkerRegistration;
    try {
        registration = await navigator.serviceWorker.register(`${base}/service-worker.js`);
    } catch {
        // Offline support is a bonus; the editor works without it
        return;
    }
    // Only an update has a controller already: the first install just starts caching
    const offer = (worker: ServiceWorker | null) => {
        if (worker && navigator.serviceWorker.controller) update.waiting = worker;
    };
    offer(registration.waiting);
    registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => {
            if (installing.state === "installed") offer(installing);
        });
    });
    // Look again now and then, for people who keep the editor open for days
    setInterval(() => void registration.update().catch(() => {}), 60 * 60 * 1000);
}

// Switches to the new version: the waiting worker takes over, then the page reloads
export function applyUpdate() {
    const worker = update.waiting;
    if (!worker) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
    worker.postMessage("skip-waiting");
}
