// Editor settings, kept in this browser, and whether the Settings dialog (SettingsModal.svelte,
// mounted once in +layout.svelte) is open.

const FONT_SIZE_KEY = "squiffy-editor-font-size";
export const DEFAULT_FONT_SIZE = 14;
export const FONT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20, 24];

function readFontSize(): number {
    try {
        const stored = Number(localStorage.getItem(FONT_SIZE_KEY));
        return FONT_SIZES.includes(stored) ? stored : DEFAULT_FONT_SIZE;
    } catch {
        return DEFAULT_FONT_SIZE;
    }
}

export const settings = $state({ open: false, fontSize: DEFAULT_FONT_SIZE });

// The code editor's text size, as the 6.x editor's Settings had. CodeMirror's theme reads it
// from a CSS variable, so changing it needs no reconfiguring.
export function applyFontSize(size: number) {
    settings.fontSize = size;
    document.documentElement.style.setProperty("--editor-font-size", `${size}px`);
}

export function setFontSize(size: number) {
    applyFontSize(size);
    try {
        localStorage.setItem(FONT_SIZE_KEY, String(size));
    } catch {
        // Not kept: it's re-read as the default next time
    }
}

export function initSettings() {
    applyFontSize(readFontSize());
}
