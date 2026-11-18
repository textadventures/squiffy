// Tells the author when a new version of the desktop app (#276) is out, by checking the GitHub
// Releases that desktop-publish.yml attaches the installers to. The web editor updates itself (its
// service worker, updates.svelte.ts), so this is only for the desktop app.
//
// Squiffy is told about stable releases. Squiffy Beta (whose version is a prerelease) is told about
// prereleases too, and about the stable release that ends a beta series. A release only counts
// once it has an installer for this platform, since they're attached a few minutes after it's made.
import { desktopApi } from "./desktop.js";

export const RELEASES_API_URL = "https://api.github.com/repos/textadventures/squiffy/releases?per_page=30";
const DISMISSED_KEY = "squiffy-desktop-update-dismissed";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Where to download a release: the docs' desktop app page, whose download button offers the newest
// stable release on squiffystory.com and the newest prerelease on beta.squiffystory.com. So a beta
// told about the stable release that ends its series goes to squiffystory.com.
export const STABLE_DOWNLOAD_URL = "https://squiffystory.com/desktop-app/";
export const BETA_DOWNLOAD_URL = "https://beta.squiffystory.com/desktop-app/";

export interface Release {
    tag_name: string;
    draft?: boolean;
    prerelease?: boolean;
    assets: { name: string }[];
}

export type Platform = "mac" | "windows" | "linux";

export interface AvailableUpdate {
    version: string;
    url: string;
}

export const desktopUpdate = $state({ available: null as AvailableUpdate | null });

// Compares two versions (semver, with an optional leading "v"): negative if a is older than b
export function compareVersions(a: string, b: string): number {
    const parse = (v: string) => {
        const [main, pre] = v.replace(/^v/, "").split(/-(.*)/s);
        return { main: main.split(".").map(n => Number(n) || 0), pre: pre ? pre.split(".") : [] };
    };
    const x = parse(a);
    const y = parse(b);
    for (let i = 0; i < 3; i++) {
        const d = (x.main[i] ?? 0) - (y.main[i] ?? 0);
        if (d) return d;
    }
    // A prerelease comes before its release
    if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
    for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
        const p = x.pre[i];
        const q = y.pre[i];
        if (p === undefined) return -1;
        if (q === undefined) return 1;
        const pn = /^\d+$/.test(p);
        const qn = /^\d+$/.test(q);
        if (pn && qn) {
            const d = Number(p) - Number(q);
            if (d) return d;
        } else if (pn !== qn) {
            return pn ? -1 : 1;
        } else if (p !== q) {
            return p < q ? -1 : 1;
        }
    }
    return 0;
}

const INSTALLERS: Record<Platform, RegExp> = {
    mac: /\.dmg$/i,
    windows: /\.exe$/i,
    linux: /\.(appimage|deb)$/i,
};

// The newest release this app should be told about, if it's newer than `current`
export function findUpdate(releases: Release[], current: string, platform: Platform): AvailableUpdate | null {
    const beta = current.includes("-");
    let best: Release | null = null;
    for (const release of releases) {
        if (release.draft || (release.prerelease && !beta)) continue;
        if (!release.assets.some(a => INSTALLERS[platform].test(a.name))) continue;
        if (compareVersions(release.tag_name, current) <= 0) continue;
        if (!best || compareVersions(release.tag_name, best.tag_name) > 0) best = release;
    }
    if (!best) return null;
    const version = best.tag_name.replace(/^v/, "");
    return { version, url: version.includes("-") ? BETA_DOWNLOAD_URL : STABLE_DOWNLOAD_URL };
}

async function check(platform: Platform) {
    try {
        const response = await fetch(RELEASES_API_URL, { headers: { Accept: "application/vnd.github+json" } });
        if (!response.ok) return;
        const update = findUpdate(await response.json() as Release[], __APP_VERSION__, platform);
        let dismissed: string | null = null;
        try {
            dismissed = localStorage.getItem(DISMISSED_KEY);
        } catch {
            // No storage: it's just asked again
        }
        desktopUpdate.available = update && update.version !== dismissed ? update : null;
    } catch {
        // Offline, or GitHub's rate limit: try again later
    }
}

// Not now: don't mention this version again
export function dismissDesktopUpdate() {
    const version = desktopUpdate.available?.version;
    desktopUpdate.available = null;
    if (!version) return;
    try {
        localStorage.setItem(DISMISSED_KEY, version);
    } catch {
        // As above
    }
}

/** Checks now and once a day while the app's open, in the desktop app. Returns a function that stops. */
export function watchForDesktopUpdates(): () => void {
    const api = desktopApi();
    if (!api || import.meta.env.DEV) return () => {};
    const platform = api.desktop.platform;
    void check(platform);
    const timer = setInterval(() => void check(platform), CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
}
