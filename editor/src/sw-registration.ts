import { registerSW } from "virtual:pwa-register";

let updateAvailableCallback: (() => void) | null = null;
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;

export function onUpdateAvailable(callback: () => void) {
    updateAvailableCallback = callback;
}

export function applyUpdate() {
    if (updateSW) {
        updateSW(true);
    }
}

export function registerServiceWorker() {
    updateSW = registerSW({
        onNeedRefresh() {
            if (updateAvailableCallback) {
                updateAvailableCallback();
            }
        },
        onOfflineReady() {
            // Could show a message that the app is ready to work offline
        },
    });
}
