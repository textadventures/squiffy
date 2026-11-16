// Detects the Electron desktop app (#276), which exposes project-fs's bridge as window.projectFs.
// Electron's Chromium supports showDirectoryPicker, but the desktop app uses its own Node file
// system bridge instead, as Quest Viva's does.
export function isElectron(): boolean {
    return typeof window !== "undefined" && "projectFs" in window;
}
