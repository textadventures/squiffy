// Light / Dark / Match system, from Quest Viva's AppShell. Dark mode is a `.dark` class on <html>
// (see app.css's @custom-variant dark) rather than Tailwind's default prefers-color-scheme media
// query, so an explicit choice can override the OS. The class flips both the dark: utilities and
// Skeleton's light-dark() paired tokens. app.html's inline script applies the stored choice before
// first paint, with the same logic as applyTheme.
import { writable, get } from "svelte/store";

export type ThemePreference = "light" | "dark" | "system";

export const theme = writable<ThemePreference>("system");

const STORAGE_KEY = "squiffy-ui-theme";

function systemIsDark(): boolean {
    if (typeof matchMedia === "undefined") return false;
    return matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(pref: ThemePreference): void {
    if (typeof document === "undefined") return;
    const dark = pref === "dark" || (pref === "system" && systemIsDark());
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

let mediaQuery: MediaQueryList | null = null;
let onSystemChange: (() => void) | null = null;

// "system" keeps tracking the OS after the first apply, e.g. macOS switching to dark at sunset.
function trackSystem(pref: ThemePreference): void {
    if (pref !== "system" || typeof matchMedia === "undefined") {
        if (onSystemChange) {
            mediaQuery?.removeEventListener("change", onSystemChange);
            onSystemChange = null;
            mediaQuery = null;
        }
        return;
    }
    if (onSystemChange) return;
    mediaQuery = matchMedia("(prefers-color-scheme: dark)");
    onSystemChange = () => applyTheme(get(theme));
    mediaQuery.addEventListener("change", onSystemChange);
}

function readStoredTheme(): ThemePreference | null {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored === "light" || stored === "dark" || stored === "system" ? stored : null;
    } catch {
        return null;
    }
}

function writeStoredTheme(pref: ThemePreference): void {
    try {
        localStorage.setItem(STORAGE_KEY, pref);
    } catch {
        // Storage can be unavailable (private browsing). The choice is just re-detected next time.
    }
}

// Called once from +layout.svelte
export function initTheme(): void {
    setTheme(readStoredTheme() ?? "system", { persist: false });
}

export function setTheme(pref: ThemePreference, opts: { persist?: boolean } = {}): void {
    theme.set(pref);
    applyTheme(pref);
    trackSystem(pref);
    if (opts.persist !== false) writeStoredTheme(pref);
}
